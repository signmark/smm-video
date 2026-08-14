import axios from 'axios';
import { log } from '../../utils/logger';

export interface InstagramStoryResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  username?: string;
  error?: string;
}

async function pollContainerStatus(
  containerId: string,
  accessToken: string,
  maxAttempts = 24
): Promise<{ ready: boolean; statusCode: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const resp = await axios.get(`https://graph.facebook.com/v19.0/${containerId}`, {
        params: { fields: 'status_code', access_token: accessToken },
        timeout: 15000
      });
      const statusCode: string = resp.data?.status_code || '';
      log(`[IGStories] Container ${containerId} status: ${statusCode} (attempt ${i + 1}/${maxAttempts})`, 'info');
      if (statusCode === 'FINISHED') return { ready: true, statusCode };
      if (statusCode === 'ERROR') return { ready: false, statusCode };
    } catch (e: any) {
      log(`[IGStories] Error polling container: ${e.message}`, 'warn');
    }
  }
  return { ready: false, statusCode: 'TIMEOUT' };
}

/**
 * Публикует Instagram Story напрямую через Graph API.
 * Реализует логику бывшего n8n воркфлоу publish-stories.
 *
 * @param contentId  ID записи campaign_content в Directus
 * @param adminToken Токен с правами чтения campaign_content и user_campaigns
 * @param overrides  Опциональные URL медиа (если уже известны до вызова)
 */
export async function publishInstagramStory(
  contentId: string,
  adminToken: string,
  overrides?: { imageUrl?: string; videoUrl?: string }
): Promise<InstagramStoryResult> {
  const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';

  if (!adminToken) {
    return { success: false, error: 'Нет токена для доступа к Directus' };
  }

  // 1. Получаем контент
  let content: any;
  try {
    const contentResp = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 15000
    });
    content = contentResp.data?.data;
  } catch (e: any) {
    return { success: false, error: `Ошибка получения контента: ${e.message}` };
  }
  if (!content) return { success: false, error: 'Контент не найден' };

  // 2. Получаем кампанию
  let igSettings: any = {};
  try {
    const campaignResp = await axios.get(`${directusUrl}/items/user_campaigns/${content.campaign_id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 15000
    });
    const campaign = campaignResp.data?.data;
    let socialSettings = campaign?.social_media_settings || {};
    if (typeof socialSettings === 'string') {
      try { socialSettings = JSON.parse(socialSettings); } catch {}
    }
    igSettings = socialSettings.instagram || {};
  } catch (e: any) {
    return { success: false, error: `Ошибка получения кампании: ${e.message}` };
  }

  const accessToken: string = igSettings.token || igSettings.accessToken || '';
  const accountId: string = igSettings.accountId || igSettings.instagram_business_account_id || igSettings.businessAccountId || '';

  if (!accessToken || !accountId) {
    return { success: false, error: 'Instagram не настроен: нет token или accountId в настройках кампании' };
  }

  // 3. Определяем URL медиа
  let imageUrl: string | undefined = overrides?.imageUrl;
  let videoUrl: string | undefined = overrides?.videoUrl;

  if (!imageUrl && !videoUrl) {
    imageUrl = content.image_url;
    videoUrl = content.video_url;

    if (!imageUrl && !videoUrl && content.additional_media) {
      try {
        const additionalMedia = typeof content.additional_media === 'string'
          ? JSON.parse(content.additional_media)
          : content.additional_media;
        if (Array.isArray(additionalMedia) && additionalMedia.length > 0) {
          const first = additionalMedia[0];
          const url: string = first?.url || (typeof first === 'string' ? first : '');
          if (url) {
            if (/\.(mp4|mov|avi|webm)/i.test(url) || first?.type === 'video') {
              videoUrl = url;
            } else {
              imageUrl = url;
            }
          }
        }
      } catch {}
    }

    if (!imageUrl && !videoUrl && content.additional_images) {
      try {
        const imgs = typeof content.additional_images === 'string'
          ? JSON.parse(content.additional_images)
          : content.additional_images;
        if (Array.isArray(imgs) && imgs.length > 0) {
          const first = imgs[0];
          imageUrl = (typeof first === 'object' ? first?.url : first) || '';
        }
      } catch {}
    }
  }

  // Если video URL есть и image нет → видео-сторис; иначе → изображение
  const isVideo = !!videoUrl && !imageUrl;

  if (!imageUrl && !videoUrl) {
    return { success: false, error: 'Нет медиафайла для Stories (нет image_url или video_url)' };
  }

  // 4. Получаем username (некритично)
  let username = 'instagram';
  try {
    const userResp = await axios.get(`https://graph.facebook.com/v18.0/${accountId}`, {
      params: { access_token: accessToken, fields: 'username,name' },
      timeout: 10000
    });
    username = userResp.data?.username || 'instagram';
  } catch {}

  // 5. Создаём медиа-контейнер
  log(`[IGStories] Creating ${isVideo ? 'video' : 'image'} Stories container for content ${contentId}`, 'info');

  let containerId: string;
  try {
    const containerParams: Record<string, string> = {
      media_type: 'STORIES',
      access_token: accessToken
    };
    if (isVideo) {
      containerParams.video_url = videoUrl!;
    } else {
      containerParams.image_url = imageUrl!;
    }

    const containerResp = await axios.post(
      `https://graph.facebook.com/v19.0/${accountId}/media`,
      null,
      { params: containerParams, timeout: 30000 }
    );
    containerId = containerResp.data?.id;
    if (!containerId) throw new Error('Пустой id в ответе создания контейнера');
  } catch (e: any) {
    const detail = e.response?.data?.error?.message || e.message;
    return { success: false, error: `Ошибка создания контейнера Stories: ${detail}` };
  }

  // 6. Ждём готовности контейнера (нужно для видео, для изображений обычно сразу FINISHED)
  const pollResult = await pollContainerStatus(containerId, accessToken);
  if (!pollResult.ready) {
    return { success: false, error: `Контейнер не готов к публикации (статус: ${pollResult.statusCode})` };
  }

  // 7. Публикуем
  let postId: string;
  try {
    const publishResp = await axios.post(
      `https://graph.facebook.com/v18.0/${accountId}/media_publish`,
      null,
      { params: { creation_id: containerId, access_token: accessToken }, timeout: 30000 }
    );
    postId = publishResp.data?.id;
    if (!postId) throw new Error('Пустой id в ответе публикации');
  } catch (e: any) {
    const detail = e.response?.data?.error?.message || e.message;
    return { success: false, error: `Ошибка публикации Stories: ${detail}` };
  }

  const postUrl = `https://www.instagram.com/stories/${username}/`;
  log(`[IGStories] Published story ${postId} for content ${contentId}, url: ${postUrl}`, 'info');

  // 8. Обновляем Directus
  try {
    const currentResp = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 10000
    });
    const existingPlatforms = currentResp.data?.data?.social_platforms || {};
    await axios.patch(
      `${directusUrl}/items/campaign_content/${contentId}`,
      {
        social_platforms: {
          ...existingPlatforms,
          instagram: {
            status: 'published',
            postUrl,
            postId,
            publishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            platform: 'instagram',
            isStory: true,
            username
          }
        }
      },
      { headers: { Authorization: `Bearer ${adminToken}` }, timeout: 10000 }
    );
  } catch (e: any) {
    log(`[IGStories] Failed to update Directus after publish: ${e.message}`, 'warn');
  }

  return { success: true, postId, postUrl, username };
}
