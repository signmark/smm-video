import express from 'express';
import axios from 'axios';
import { authenticateUser } from '../middleware/user-auth';
import { assertContentBelongsToRequester } from '../services/content-access';
import { telegramHttp } from '../services/social-platforms/telegram-http';

const router = express.Router();

/**
 * Удаление публикации из социальных сетей и перевод в черновики
 * POST /api/content/:id/unpublish
 *
 * Проверка владения обязательна: ручка достаёт токены соцсетей кампании и
 * РЕАЛЬНО удаляет посты на платформах — по чужому id это удаление чужих
 * публикаций (находка ревью 2026-07-28).
 */
router.post('/content/:id/unpublish', authenticateUser, async (req, res) => {
  const { id } = req.params;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'Требуется авторизация'
      });
    }

    if (!(await assertContentBelongsToRequester(id, req, res))) return;

    // Получаем данные контента
    const contentResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/campaign_content/${id}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = contentResponse.data.data;
    const campaignId = content.campaign_id;
    // AI-114: читаем канончный snake-ключ (и camel как fallback для
    // совместимости), иначе список площадок всегда пуст и ниже нечему
    // удаляться/сбрасываться. Directus может отдавать поле и объектом, и
    // JSON-строкой — нормализуем.
    let socialPlatforms = content.social_platforms || content.socialPlatforms || {};
    if (typeof socialPlatforms === 'string') {
      try { socialPlatforms = JSON.parse(socialPlatforms); } catch { socialPlatforms = {}; }
    }
    const deletionResults: { platform: string; success: boolean; error?: string }[] = [];

    if (!campaignId) {
      // Пытаемся найти campaign_id в другом поле, если оно пустое
      // В некоторых схемах это может быть просто campaign
    }

    // Подготавливаем обновленные данные. Важно: сбрасываем площадку в черновик
    // ТОЛЬКО если удаление на платформе реально состоялось — иначе сотрём
    // историю опубликованного поста (регрессия AI-87, которую сдерживал баг с
    // именем поля).
    const updatedSocialPlatforms: Record<string, any> = {};
    
    for (const [platform, data] of Object.entries(socialPlatforms)) {
      const platformData = data as any;
      
      // Если есть postId, пробуем удалить через API
      if (platformData.postId) {
        try {
          if (campaignId) {
            await deleteFromPlatform(platform, platformData.postId, userToken, campaignId);
            deletionResults.push({ platform, success: true });
            // Только после УСПЕШНОГО удаления сбрасываем площадку.
            updatedSocialPlatforms[platform] = {
              ...platformData,
              status: 'draft',
              postId: null,
              postUrl: null,
              publishedAt: null,
              error: null,
              unpublishError: null
            };
          } else {
            console.warn(`Cannot delete from ${platform}: campaignId is missing`);
            deletionResults.push({ platform, success: false, error: 'Campaign ID missing' });
            updatedSocialPlatforms[platform] = { ...platformData, unpublishError: 'Campaign ID missing' };
          }
        } catch (error: any) {
          console.error(`Failed to delete from ${platform}:`, error.response?.data || error.message);
          deletionResults.push({ 
            platform, 
            success: false, 
            error: error.response?.data?.error?.message || error.message 
          });
          // Удаление не удалось — сохраняем прежнее состояние + причину.
          updatedSocialPlatforms[platform] = {
            ...platformData,
            unpublishError: error.response?.data?.error?.message || error.message || 'Неизвестная ошибка удаления'
          };
        }
      } else {
        // Нет postId — удалять нечего, историю не трогаем.
        updatedSocialPlatforms[platform] = platformData;
      }
    }

    const anyDeleted = deletionResults.some((r) => r.success);

    // AI-114: честный ответ. Если ни одна площадка не была реально снята —
    // не говорим пользователю «снята».
    if (!anyDeleted) {
      return res.status(409).json({
        success: false,
        error: 'Не удалось снять публикацию ни с одной площадки',
        deletionResults
      });
    }

    // Материал переводим в черновик ТОЛЬКО когда снялись ВСЕ площадки с postId.
    // Знаменатель тоже считаем только по площадкам с postId: площадки без postId
    // в deletionResults не попадают и удалять с них нечего, поэтому если считать
    // их в знаменателе, материал навсегда останется published при смешанном наборе
    // (рецензия @Clause_Dev_Hermi, ~40% материалов на проде смешанные).
    const platformsWithPostId = Object.entries(socialPlatforms)
      .filter(([, d]) => Boolean((d as any)?.postId))
      .map(([k]) => k);
    const totalPlatforms = platformsWithPostId.length;
    const deletedCount = deletionResults.filter((r) => r.success).length;
    const allDeleted = deletedCount === totalPlatforms;

    // Подготавливаем данные для обновления контента (snake-ключ).
    const updateData: any = {
      ...(allDeleted ? { status: 'draft', published_at: null } : {}),
      social_platforms: updatedSocialPlatforms
    };

    // Обновляем в Directus
    await axios.patch(
      `${process.env.DIRECTUS_URL}/items/campaign_content/${id}`,
      updateData,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      message: allDeleted
        ? 'Публикация снята со всех площадок и контент возвращен в черновики'
        : 'Публикация частично снята: часть площадок осталась опубликованной',
      deletionResults
    });

  } catch (error: any) {
    console.error('Error unpublishing content:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка при снятии публикации',
      details: error.response?.data || error.message
    });
  }
});

/**
 * Алиас для /api/campaign-content/:id/unpublish для совместимости
 */
router.post('/campaign-content/:id/unpublish', async (req, res) => {
  // Перенаправляем на основной обработчик
  req.url = `/content/${req.params.id}/unpublish`;
  return router.handle(req, res, () => {});
});

/**
 * Удаление поста из конкретной платформы
 */
async function deleteFromPlatform(platform: string, postId: string, userToken: string, campaignId: string): Promise<void> {
  const normalizedPlatform = platform.toLowerCase();
  console.log(`[Unpublish] Attempting to delete from ${normalizedPlatform}, postId: ${postId}`);

  switch (normalizedPlatform) {
    case 'facebook':
    case 'facebook_video':
      // Facebook Graph API: DELETE /{post-id}
      await axios.delete(`https://graph.facebook.com/v18.0/${postId}`, {
        params: {
          access_token: await getPlatformToken('facebook', userToken, campaignId)
        }
      });
      break;

    case 'instagram':
    case 'instagram_story':
    case 'instagram_reel':
      // Instagram Graph API: DELETE /{media-id}
      await axios.delete(`https://graph.facebook.com/v18.0/${postId}`, {
        params: {
          access_token: await getPlatformToken('instagram', userToken, campaignId)
        }
      });
      break;

    case 'vk':
    case 'vk_video':
    case 'vk_clip':
    case 'vk_story':
      // VK API: wall.delete
      // Формат postId: "owner_id_post_id" (например: "-184289321_9")
      let ownerId: string | null = null;
      let vkPostId: string | null = null;

      if (postId.includes('_')) {
        [ownerId, vkPostId] = postId.split('_');
      }

      if (!ownerId || !vkPostId) {
        // Не owner_id_post_id — удалить через wall.delete нельзя (AI-114).
        throw new Error(`[Unpublish] Неизвестный формат postId ВК: ${postId} (ожидается owner_id_post_id)`);
      }
      
      await axios.post('https://api.vk.com/method/wall.delete', null, {
        params: {
          owner_id: ownerId,
          post_id: vkPostId,
          access_token: await getPlatformToken('vk', userToken, campaignId),
          v: '5.131'
        }
      });
      break;

    case 'telegram':
      // Telegram Bot API: deleteMessage
      const botToken = await getPlatformToken('telegram', userToken, campaignId);
      // Формат postId может быть "chatId_messageId" или просто "messageId" если chatId в настройках
      if (postId.includes('_')) {
        const [chatId, messageId] = postId.split('_');
        await (await telegramHttp()).post(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
          chat_id: chatId,
          message_id: messageId
        });
      } else {
        // Пытаемся получить chatId из настроек
        const campaignResponse = await axios.get(
          `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
          {
            headers: { Authorization: `Bearer ${userToken}` }
          }
        );
        const chatId = campaignResponse.data.data.social_media_settings?.telegram?.chat_id;
        if (chatId) {
          await (await telegramHttp()).post(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
            chat_id: chatId,
            message_id: postId
          });
        } else {
          // Нет chat_id ни в postId, ни в настройках — удалить нельзя (AI-114).
          throw new Error('[Unpublish] Telegram: не из чего получить chat_id для удаления');
        }
      }
      break;

    case 'youtube':
    case 'youtube_short':
      // YouTube Data API: videos.delete
      await axios.delete('https://www.googleapis.com/youtube/v3/videos', {
        params: { id: postId },
        headers: {
          Authorization: `Bearer ${await getPlatformToken('youtube', userToken, campaignId)}`
        }
      });
      break;

    default:
      throw new Error(`[Unpublish] Удаление для платформы ${platform} не реализовано`);
  }
}

/**
 * Получение токена доступа для платформы из настроек кампании
 */
async function getPlatformToken(platform: string, userToken: string, campaignId: string): Promise<string> {
  try {
    const campaignResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const campaign = campaignResponse.data.data;
    const socialSettings = campaign.social_media_settings || {};
    const platformKey = platform.toLowerCase().split('_')[0]; // facebook, instagram, vk, telegram, youtube
    const platformSettings = socialSettings[platformKey] || {};

    const tokenFieldMap: Record<string, string> = {
      facebook: 'token',
      instagram: 'accessToken',
      vk: 'access_token',
      telegram: 'bot_token',
      youtube: 'accessToken'
    };

    const tokenField = tokenFieldMap[platformKey];
    const token = platformSettings[tokenField];

    if (!token) {
      throw new Error(`Токен для ${platformKey} не найден в настройках кампании`);
    }

    return token;
  } catch (error: any) {
    console.error(`Error getting platform token for ${platform}:`, error.message);
    throw new Error(`Не удалось получить токен для ${platform}: ${error.message}`);
  }
}

export default router;
