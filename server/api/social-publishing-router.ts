/**
 * Маршрутизатор публикации в социальные сети
 * Этот файл отвечает за перенаправление запросов публикации контента
 * на соответствующие обработчики для разных социальных платформ.
 */

import express from 'express';
import axios from 'axios';
import { log } from '../utils/logger';
import { authMiddleware } from '../middleware/auth';
import { publicationLockManager } from '../services/publication-lock-manager';
import * as instagramCarouselHandler from './instagram-carousel-webhook';
import { storage } from '../storage';
import { SocialPlatform } from '@shared/schema';
import { vkStoriesService } from '../services/social-platforms/vk-stories-service';
import { normalizePlatforms, createPendingStatuses, extractPlatformNames } from '../utils/platforms-helper';
import { getTempVideo, deleteTempVideo } from '../utils/temp-video-store';
import { invalidateContentCache } from '../utils/content-cache';
import { getContentAggregateTimes, getContentPublicationStatus } from '@shared/schedule-time';

const router = express.Router();

// Диагностические endpoints не должны быть доступны в production (утечка инфраструктуры).
const devOnly = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
};

// Публичный эндпоинт для временного видео (без auth — нужен Meta серверам для Threads)
// Поддерживает HEAD + Range-запросы (Threads API требует byte-range support)
function serveVideoTemp(req: express.Request, res: express.Response) {
  const entry = getTempVideo(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: 'Video not found or expired' });
  }

  const total = entry.buffer.length;
  const contentType = entry.contentType || 'video/mp4';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');

  const rangeHeader = req.headers['range'];

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : total - 1;
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', chunkSize);
      return res.end(entry.buffer.slice(start, end + 1));
    }
  }

  res.setHeader('Content-Length', total);
  if (req.method === 'HEAD') {
    return res.end();
  }
  return res.end(entry.buffer);
  // НЕ удаляем после первой раздачи — Threads делает несколько запросов
  // TTL очищает через 10 минут автоматически
}
router.head('/video-temp/:id', serveVideoTemp);
router.get('/video-temp/:id', serveVideoTemp);

// Helper: Upload image to ImgBB with Cloudinary fallback for Instagram Stories
async function uploadImageForInstagram(imageUrl: string): Promise<{ url: string; host: string }> {

  // Download image first
  const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const imageBuffer = Buffer.from(imageResponse.data);
  const base64Image = imageBuffer.toString('base64');

  // Try ImgBB first
  try {
    const formData = new FormData();
    formData.append('image', base64Image);
    formData.append('name', `instagram-story-${Date.now()}`);

    const imgbbResponse = await axios.post('https://api.imgbb.com/1/upload', formData, {
      params: {
        key: process.env.IMGBB_API_KEY || '24b7a2b8c7d4563497ca48e07d0c76ba'
      },
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 20000
    });

    if (imgbbResponse.data.success) {
      const url = imgbbResponse.data.data.display_url;
      return { url, host: 'imgbb' };
    }
  } catch (imgbbError: any) {
  }

  // Fallback to Cloudinary
  try {
    const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dc6bcrsyl';
    const cloudinaryUploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'instagram_stories';

    const cloudinaryFormData = new FormData();
    cloudinaryFormData.append('file', `data:image/jpeg;base64,${base64Image}`);
    cloudinaryFormData.append('upload_preset', cloudinaryUploadPreset);
    cloudinaryFormData.append('folder', 'instagram-stories');

    const cloudinaryResponse = await axios.post(
      `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`,
      cloudinaryFormData,
      { timeout: 30000 }
    );

    if (cloudinaryResponse.data.secure_url) {
      const url = cloudinaryResponse.data.secure_url;
      return { url, host: 'cloudinary' };
    }
  } catch (cloudinaryError: any) {
  }

  throw new Error('Не удалось загрузить на ImgBB или Cloudinary');
}

/**
 * @api {post} /api/stories/publish Публикация Stories в выбранные платформы
 * @apiDescription Отдельный роут для публикации Stories (Instagram, будущие Telegram Stories)
 * @apiVersion 1.0.0
 * @apiName PublishStories
 * @apiGroup StoriesPublishing
 * 
 * @apiParam {String} contentId ID Stories контента для публикации
 * @apiParam {Object} platforms Объект с выбранными платформами для Stories
 * 
 * @apiSuccess {Boolean} success Статус операции
 * @apiSuccess {Object} result Результат публикации Stories
 */
router.post('/stories/publish', authMiddleware, async (req, res) => {
  try {
    const { contentId, platforms, generatedImageUrl, generatedVideoUrl, useGeneratedImage, useGeneratedVideo, scheduledAt } = req.body;

    console.log('[PUBLISH] === НАЧАЛО ПУБЛИКАЦИИ STORIES ===');
    console.log('[PUBLISH] Запрос на публикацию:', {
      contentId,
      platforms,
      generatedImageUrl: generatedImageUrl ? 'есть' : 'нет',
      generatedVideoUrl: generatedVideoUrl ? 'есть' : 'нет',
      useGeneratedImage,
      useGeneratedVideo
    });
    console.log('[PUBLISH] Полный body запроса:', JSON.stringify(req.body, null, 2));
    console.log('[PUBLISH] Полный body запроса:', JSON.stringify(req.body, null, 2));

    if (!contentId) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId для Stories'
      });
    }

    // Валидируем платформы для Stories
    const validStoriesPlatforms = ['instagram', 'telegram', 'vk'];
    const allPlatforms = extractPlatformNames(platforms);
    const selectedPlatforms = allPlatforms.filter(p => validStoriesPlatforms.includes(p));


    if (selectedPlatforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо выбрать хотя бы одну платформу для Stories'
      });
    }

    // Получаем Stories контент из Directus
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';

    // Используем пользовательский токен (согласно архитектуре: UI uses user tokens for all API requests)
    const userToken = req.headers.authorization?.replace('Bearer ', '');

    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'Отсутствует токен авторизации'
      });
    }


    // Тестируем валидность пользовательского токена
    try {
      const tokenTestResponse = await axios.get(`${directusUrl}/users/me`, {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      });
    } catch (tokenError: any) {
      return res.status(401).json({
        success: false,
        error: 'Недействительный токен пользователя',
        details: tokenError.message
      });
    }

    try {
      const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      });

      const storyContent = contentResponse.data.data;

      console.log('[PUBLISH] === ДАННЫЕ ИЗ DIRECTUS ===');
      console.log('[PUBLISH] storyContent.video_url:', storyContent.video_url || 'НЕТ');
      console.log('[PUBLISH] storyContent.image_url:', storyContent.image_url || 'НЕТ');
      console.log('[PUBLISH] storyContent.backgroundVideoUrl:', storyContent.backgroundVideoUrl || 'НЕТ');
      console.log('[PUBLISH] storyContent.mediaType:', storyContent.mediaType || 'НЕТ');
      console.log('[PUBLISH] storyContent.additional_media:', storyContent.additional_media ? 'есть' : 'нет');

      // Проверяем, что это действительно Stories контент
      if (storyContent.content_type !== 'story') {
        return res.status(400).json({
          success: false,
          error: 'Контент не является Stories'
        });
      }

      // Формируем social_platforms с pending статусами для выбранных платформ
      const isScheduled = !!scheduledAt;
      const pendingSocialPlatforms = createPendingStatuses(selectedPlatforms, isScheduled);

      // Если есть дата планирования, добавляем её во все платформы
      if (scheduledAt) {
        for (const platform of selectedPlatforms) {
          pendingSocialPlatforms[platform].scheduledAt = scheduledAt;
          pendingSocialPlatforms[platform].scheduled_at = scheduledAt;
        }
      }


      // Обновляем статус Stories перед публикацией
      // ВАЖНО: НЕ пишем platforms как массив! Только social_platforms как объект
      const updateData: any = {
        status: 'scheduled',
        social_platforms: pendingSocialPlatforms,
        updated_at: new Date().toISOString()
      };

      // Если есть scheduledAt, добавляем его в основные поля контента
      if (scheduledAt) {
        updateData.scheduled_at = scheduledAt;
      }

      await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, updateData, {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      });


      const webhookPromises: Promise<any>[] = [];

      for (const platform of selectedPlatforms) {
        // VK Stories - прямая публикация через сервис (без n8n)
        if (platform === 'vk') {

          webhookPromises.push(
            vkStoriesService.publishStory(contentId, userToken).then(result => {
              if (result.success) {
                return {
                  platform: 'vk',
                  success: true,
                  status: 200,
                  data: { storyId: result.storyId, storyUrl: result.storyUrl }
                };
              } else {
                return {
                  platform: 'vk',
                  success: false,
                  error: result.error
                };
              }
            }).catch(error => {
              return {
                platform: 'vk',
                success: false,
                error: error.message
              };
            })
          );
          continue;
        }

        // Instagram Stories → прямая публикация через Instagram Graph API
        if (platform === 'instagram') {
          webhookPromises.push(
            (async () => {
              const { publishInstagramStory } = await import('../services/social-platforms/instagram-stories-service');
              const overrideImageUrl: string | undefined = (generatedImageUrl || storyContent?.image_url) || undefined;
              const overrideVideoUrl: string | undefined = (generatedVideoUrl || storyContent?.video_url || storyContent?.backgroundVideoUrl) || undefined;
              const adminTok = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
              const result = await publishInstagramStory(contentId, adminTok, { imageUrl: overrideImageUrl, videoUrl: overrideVideoUrl });
              return { platform: 'instagram', success: result.success, status: result.success ? 200 : 500, data: result, error: result.error };
            })().catch((err: any) => ({ platform: 'instagram', success: false, error: err.message }))
          );
          continue;
        }

        // Telegram Stories → Bot API не поддерживает Stories
        if (platform === 'telegram') {
          webhookPromises.push(Promise.resolve({
            platform: 'telegram',
            success: false,
            error: 'Telegram Stories публикуются через мобильное приложение — Bot API не поддерживает публикацию Stories'
          }));
          continue;
        }

        // Прочие платформы — не поддерживают Stories
        webhookPromises.push(Promise.resolve({ platform, success: false, error: `Платформа ${platform} не поддерживает Stories` }));
        continue;

        // Устаревший код (недостижим после continue выше)
        const n8nUrl = '';
        let webhookUrl = '';

        if (platform === 'instagram') {
          webhookUrl = `${n8nUrl}/webhook/publish-stories`;

          console.log('[PUBLISH] Определяем тип медиа для Instagram:', {
            useGeneratedVideo,
            generatedVideoUrl: generatedVideoUrl ? 'есть' : 'нет',
            generatedImageUrl: generatedImageUrl ? 'есть' : 'нет',
            storyMediaType: storyContent.mediaType,
            storyVideoUrl: storyContent.video_url ? 'есть' : 'нет',
            storyBackgroundVideoUrl: storyContent.backgroundVideoUrl ? 'есть' : 'нет',
            storyImageUrl: storyContent.image_url ? 'есть' : 'нет'
          });

          // Определяем тип медиа: видео или изображение
          // Проверяем generatedVideoUrl из запроса (приоритет)
          // Затем проверяем поля storyContent
          // Также проверяем additional_media для сгенерированного видео
          let videoUrl = generatedVideoUrl;
          let imageUrl = generatedImageUrl || storyContent.image_url;

          // Если нет generatedVideoUrl, ищем в storyContent
          // ВАЖНО: video_url в storyContent - это главный признак видео!
          if (!videoUrl) {
            // Приоритет: video_url из storyContent (главный признак)
            videoUrl = storyContent.video_url ||
              storyContent.backgroundVideoUrl ||
              (storyContent.content && typeof storyContent.content === 'object' && storyContent.content.videoUrl);

            // Проверяем additional_media для сгенерированного видео
            if (!videoUrl && storyContent.additional_media) {
              try {
                const additionalMedia = typeof storyContent.additional_media === 'string'
                  ? JSON.parse(storyContent.additional_media)
                  : storyContent.additional_media;

                if (Array.isArray(additionalMedia)) {
                  const generatedVideo = additionalMedia.find((item: any) =>
                    item.type === 'generated_video' || item.type === 'instagram_ready_video'
                  );
                  if (generatedVideo?.url) {
                    videoUrl = generatedVideo.url;
                    console.log('[PUBLISH] Найдено видео в additional_media:', generatedVideo.url);
                  }
                }
              } catch (e) {
                console.warn('[PUBLISH] Ошибка парсинга additional_media:', e);
              }
            }
          }

          // ВАЖНО: Если video_url заполнено в storyContent, но videoUrl еще не установлен - устанавливаем его
          if (storyContent.video_url && !videoUrl) {
            videoUrl = storyContent.video_url;
            console.log('[PUBLISH] Устанавливаем videoUrl из storyContent.video_url:', videoUrl);
          }

          // Определяем тип медиа
          // ВАЖНО: video_url и image_url взаимоисключающие!
          // Если video_url заполнено - это видео
          // Если image_url заполнено - это изображение
          const hasVideoUrl = !!storyContent.video_url;
          const hasImageUrl = !!storyContent.image_url;

          // Простая логика: если есть video_url - это видео, иначе проверяем другие признаки
          const isVideo = hasVideoUrl ||  // Главный признак - наличие video_url
            (useGeneratedVideo && !hasImageUrl) ||
            (!!generatedVideoUrl && !hasImageUrl) ||
            (videoUrl && !hasImageUrl && (
              storyContent.mediaType === 'video' ||
              (storyContent.content && typeof storyContent.content === 'object' && storyContent.content.mediaType === 'video') ||
              storyContent.backgroundVideoUrl
            ));

          console.log('[PUBLISH] Проверка полей контента:', {
            hasVideoUrl,
            hasImageUrl,
            isVideo,
            videoUrl: videoUrl ? 'есть' : 'нет',
            imageUrl: imageUrl ? 'есть' : 'нет'
          });

          // Обработка видео
          // ВАЖНО: Если есть generatedVideoUrl или useGeneratedVideo - это точно видео
          // Приоритет: useGeneratedVideo/generatedVideoUrl > isVideo проверка
          const shouldPublishVideo = (useGeneratedVideo || generatedVideoUrl) || (isVideo && videoUrl);

          // Если есть useGeneratedVideo или generatedVideoUrl - обязательно публикуем как видео
          if (shouldPublishVideo) {
            // ШАГ 1: Определяем videoUrl для сохранения и публикации
            // Если generatedVideoUrl не передан, но есть useGeneratedVideo, ищем в additional_media
            let videoUrlToSave = generatedVideoUrl;
            if (!videoUrlToSave && useGeneratedVideo && storyContent.additional_media) {
              try {
                const additionalMedia = typeof storyContent.additional_media === 'string'
                  ? JSON.parse(storyContent.additional_media)
                  : storyContent.additional_media;

                if (Array.isArray(additionalMedia)) {
                  const generatedVideo = additionalMedia.find((item: any) =>
                    item.type === 'generated_video' || item.type === 'instagram_ready_video'
                  );
                  if (generatedVideo?.url) {
                    videoUrlToSave = generatedVideo.url;
                    console.log('[PUBLISH] Найден generatedVideoUrl в additional_media:', videoUrlToSave);
                  }
                }
              } catch (e) {
                console.warn('[PUBLISH] Ошибка поиска видео в additional_media:', e);
              }
            }

            // Если videoUrlToSave не найден, используем videoUrl из других источников
            if (!videoUrlToSave) {
              videoUrlToSave = videoUrl;
            }

            console.log('[PUBLISH] Публикуем видео Stories в Instagram:', {
              useGeneratedVideo,
              generatedVideoUrl: generatedVideoUrl || 'нет',
              videoUrl: videoUrl || 'нет',
              videoUrlToSave: videoUrlToSave || 'нет',
              reason: useGeneratedVideo || generatedVideoUrl ? 'useGeneratedVideo/generatedVideoUrl' : 'isVideo check'
            });

            // ШАГ 2: Сохраняем generatedVideoUrl в additional_media перед публикацией
            if (videoUrlToSave) {
              try {
                // Получаем текущий additional_media
                let currentAdditionalMedia: any[] = [];
                if (storyContent.additional_media) {
                  try {
                    currentAdditionalMedia = typeof storyContent.additional_media === 'string'
                      ? JSON.parse(storyContent.additional_media)
                      : storyContent.additional_media;
                    if (!Array.isArray(currentAdditionalMedia)) {
                      currentAdditionalMedia = [];
                    }
                  } catch (e) {
                    currentAdditionalMedia = [];
                  }
                }

                // Проверяем, нет ли уже этого видео в additional_media
                const existingVideo = currentAdditionalMedia.find((item: any) =>
                  item.type === 'generated_video' && item.url === videoUrlToSave
                );

                // Если видео еще не сохранено, добавляем его
                if (!existingVideo) {
                  currentAdditionalMedia.push({
                    type: 'generated_video',
                    url: videoUrlToSave,
                    generated_at: new Date().toISOString(),
                    purpose: 'stories_publication',
                    platform: 'instagram'
                  });

                  // Сохраняем в Directus
                  await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
                    additional_media: JSON.stringify(currentAdditionalMedia),
                    updated_at: new Date().toISOString()
                  }, {
                    headers: { 'Authorization': `Bearer ${userToken}` }
                  });

                  console.log('[PUBLISH] generatedVideoUrl сохранен в additional_media:', videoUrlToSave);

                  // Обновляем videoUrl из сохраненных данных
                  videoUrl = videoUrlToSave;
                } else {
                  console.log('[PUBLISH] generatedVideoUrl уже есть в additional_media');
                  // Используем существующий URL
                  videoUrl = existingVideo.url;
                }
              } catch (saveError: any) {
                console.warn('[PUBLISH] Не удалось сохранить generatedVideoUrl в additional_media:', saveError?.message);
                // Продолжаем публикацию даже если не удалось сохранить
              }
            }

            // ШАГ 3: Используем videoUrlToSave для публикации
            const finalVideoUrl = videoUrlToSave;

            console.log('[PUBLISH] Финальный videoUrl для публикации:', finalVideoUrl ? 'есть' : 'нет', finalVideoUrl);

            if (!finalVideoUrl) {
              console.warn('[PUBLISH] URL видео не найден для публикации, пропускаем');
              webhookPromises.push(Promise.resolve({
                platform: 'instagram',
                success: false,
                error: 'URL видео не найден для публикации'
              }));
              continue;
            }

            console.log('[PUBLISH] Видео сохранено в additional_media, отправляем contentId в workflow:', contentId);

            // ШАГ 4: Отправляем только contentId в workflow
            // Workflow сам получит данные контента из Directus
            // ВАЖНО: Workflow должен запрашивать поле 'additional_media' при получении контента из Directus
            // для доступа к сгенерированному видео (type: 'generated_video')
            const videoPayload = {
              contentId: contentId
            };

            webhookPromises.push(
              axios.post(webhookUrl.replace(/([^:]\/)\/+/g, "$1"), videoPayload, {
                timeout: 60000, // Увеличиваем таймаут для видео
                headers: { 'Content-Type': 'application/json' }
              }).then(response => {
                return {
                  platform: 'instagram',
                  success: true,
                  status: response.status,
                  data: response.data || { status: 'accepted' }
                };
              }).catch(error => {
                return {
                  platform: 'instagram',
                  success: false,
                  error: error.message,
                  details: error.response?.data
                };
              })
            );
            continue;
          }

          // Обработка изображения (существующая логика)
          let imageUrlForInstagram = imageUrl;

          if (!imageUrlForInstagram) {
            webhookPromises.push(Promise.resolve({
              platform: 'instagram',
              success: false,
              error: 'Нет медиа для публикации (ни видео, ни изображения)'
            }));
            continue;
          }

          // Если изображение уже на ImgBB (generatedImageUrl), используем его напрямую
          // Иначе загружаем на ImgBB/Cloudinary
          let finalImageUrl = imageUrlForInstagram;

          if (!generatedImageUrl) {
            // Загружаем на ImgBB/Cloudinary только если нет готового URL
            try {
              const uploadResult = await uploadImageForInstagram(imageUrlForInstagram);
              finalImageUrl = uploadResult.url;

              // Сохраняем URL в additional_media контента
              try {
                const additionalMedia = [{
                  type: 'instagram_ready_image',
                  url: uploadResult.url,
                  host: uploadResult.host,
                  generated_at: new Date().toISOString(),
                  purpose: 'instagram_stories'
                }];

                await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
                  additional_media: JSON.stringify(additionalMedia),
                  updated_at: new Date().toISOString()
                }, {
                  headers: { 'Authorization': `Bearer ${userToken}` }
                });

              } catch (saveError: any) {
              }
            } catch (uploadError: any) {
              webhookPromises.push(Promise.resolve({
                platform: 'instagram',
                success: false,
                error: `Ошибка загрузки изображения: ${uploadError?.message}`
              }));
              continue;
            }
          }

          // Для изображений тоже отправляем только contentId
          // Workflow сам получит данные контента из Directus, включая additional_media
          webhookPromises.push(
            axios.post(webhookUrl.replace(/([^:]\/)\/+/g, "$1"), {
              contentId: contentId
            }, {
              timeout: 30000,
              headers: { 'Content-Type': 'application/json' }
            }).then(response => {
              return {
                platform: 'instagram',
                success: true,
                status: response.status,
                data: response.data || { status: 'accepted' }
              };
            }).catch(error => {
              return {
                platform: 'instagram',
                success: false,
                error: error.message
              };
            })
          );
          continue;

        } else if (platform === 'telegram') {
          webhookUrl = `${n8nUrl}/webhook/publish-telegram-stories`;
        }

        // Убираем двойные слеши из URL
        webhookUrl = webhookUrl.replace(/([^:]\/)\/+/g, "$1");

        if (webhookUrl) {

          webhookPromises.push(
            axios.post(webhookUrl, {
              contentId: contentId
            }, {
              timeout: 30000,
              headers: {
                'Content-Type': 'application/json'
              }
            }).then(response => {

              let responseData = null;
              try {
                responseData = response.data || { status: 'accepted' };
              } catch (parseError) {
                responseData = { status: 'accepted' };
              }

              return {
                platform,
                success: true,
                status: response.status,
                data: responseData
              };
            }).catch(error => {
              return {
                platform,
                success: false,
                error: error.message,
                status: error.response?.status
              };
            })
          );
        }
      }

      const results = await Promise.all(webhookPromises);

      const successfulPublications = results.filter(r => r.success);
      const failedPublications = results.filter(r => !r.success);

      return res.json({
        success: successfulPublications.length > 0,
        message: `Stories опубликован в ${successfulPublications.length} из ${results.length} платформ`,
        results: {
          successful: successfulPublications,
          failed: failedPublications
        }
      });

    } catch (directusError: any) {
      if (directusError.response?.status === 403) {

        return res.status(403).json({
          success: false,
          error: 'Нет прав доступа к Stories контенту',
          details: `User ${(req as any).user?.id} cannot access content ${contentId}`,
          directusErrors: directusError.response?.data?.errors
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Ошибка получения Stories контента',
        details: directusError.message
      });
    }

  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: 'Ошибка публикации Stories',
      details: error.message
    });
  }
});

/**
 * @api {post} /api/publish/now Публикация контента сразу в выбранные социальные сети
 * @apiDescription Публикует контент сразу в выбранные социальные сети и сохраняет выбранные платформы
 * @apiVersion 1.0.0
 * @apiName PublishContentNow
 * @apiGroup SocialPublishing
 * 
 * @apiParam {String} contentId ID контента для публикации
 * @apiParam {Object} platforms Объект с выбранными платформами, например: {telegram: true, vk: true, instagram: false}
 * 
 * @apiSuccess {Boolean} success Статус операции
 * @apiSuccess {Object} result Результат публикации
 */
router.post('/publish/now', authMiddleware, async (req, res) => {
  try {
    const { contentId, platforms } = req.body;


    log(`[Social Publishing] Получен запрос на публикацию с телом: ${JSON.stringify(req.body)}`);
    log(`[Social Publishing] Запрос на публикацию контента ${contentId} сразу в несколько платформ: ${JSON.stringify(platforms)}`);

    if (!contentId) {
      log(`[Social Publishing] Ошибка: не указан contentId`);
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId'
      });
    }

    // Проверяем, что платформы указаны и это объект или массив
    if (!platforms || (typeof platforms !== 'object' && !Array.isArray(platforms))) {
      log(`[Social Publishing] Ошибка: платформы не указаны или имеют неверный тип: ${JSON.stringify(platforms)}`);
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать платформы для публикации'
      });
    }

    // Поддерживаем два формата: объект {platformName: boolean} и массив строк ["platform1", "platform2"]
    log(`[Social Publishing] Проверка формата объекта platforms: ${JSON.stringify(platforms)}`);
    const validPlatformKeys = ['telegram', 'vk', 'instagram', 'facebook', 'youtube', 'threads', 'tiktok'];

    let selectedPlatforms: string[] = [];

    // Извлекаем платформы используя хелпер
    const allPlatforms = extractPlatformNames(platforms);
    selectedPlatforms = allPlatforms.filter(p => validPlatformKeys.includes(p));

    log(`[Social Publishing] Валидные платформы: ${selectedPlatforms.join(', ')}`);

    if (selectedPlatforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Не выбрано ни одной платформы для публикации'
      });
    }

    // 🎯 Фильтруем платформы по совместимости с типом контента
    try {
      const { filterCompatiblePlatforms, getIncompatibilityReason } = await import('../utils/content-type-platform-map');
      const directusUrl = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
      const adminTk = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || '';
      const contentResp = await axios.get(`${directusUrl}/items/campaign_content/${contentId}?fields=content_type`, {
        headers: { Authorization: `Bearer ${adminTk}` }
      });
      const contentType: string | undefined = contentResp.data?.data?.content_type;
      if (contentType) {
        const compatible = filterCompatiblePlatforms(selectedPlatforms, contentType);
        const removed = selectedPlatforms.filter(p => !compatible.includes(p));
        if (removed.length > 0) {
          removed.forEach(p => log(`[Social Publishing] ⛔ Платформа "${p}" несовместима с типом контента "${contentType}" — исключена. ${getIncompatibilityReason(p, contentType)}`));
        }
        selectedPlatforms = compatible;
        if (selectedPlatforms.length === 0) {
          return res.status(400).json({
            success: false,
            error: `Ни одна из выбранных платформ не поддерживает тип контента "${contentType}". ${removed.map(p => getIncompatibilityReason(p, contentType)).join('; ')}`
          });
        }
      }
    } catch (filterErr: any) {
      log(`[Social Publishing] Не удалось проверить совместимость типа контента: ${filterErr.message}`);
    }

    log(`[Social Publishing] Выбранные платформы: ${selectedPlatforms.join(', ')}`);

    // Используем постоянный DIRECTUS_TOKEN для публикации (с fallback на другие токены)
    let adminToken = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_SERVICE_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;

    // ПРИНУДИТЕЛЬНО: Пробуем получить свежий токен через менеджер, если есть userId
    try {
      const { directusAuthManager } = await import('../services/directus-auth-manager');
      const userId = (req as any).user?.id;
      if (userId) {
        const validToken = await directusAuthManager.getValidToken(userId);
        if (validToken) {
          adminToken = validToken;
          log(`[Social Publishing] Using refreshed user token for publication: ${userId}`);
        }
      }

      // Если токен пользователя не получен, пробуем получить гарантированный админский токен
      if (!adminToken || adminToken === process.env.DIRECTUS_TOKEN) {
        const validAdminToken = await directusAuthManager.getAdminAuthToken();
        if (validAdminToken) {
          adminToken = validAdminToken;
          log(`[Social Publishing] Using guaranteed admin token for publication`);
        }
      }
    } catch (e) {
      log(`[Social Publishing] Failed to refresh token via manager: ${e}`);
    }

    if (!adminToken) {
      log(`[Social Publishing] DIRECTUS_TOKEN не найден в переменных окружения`);
      return res.status(500).json({
        success: false,
        error: 'Отсутствует токен для публикации'
      });
    }

    log(`[Social Publishing] Используем DIRECTUS_TOKEN для публикации: ${adminToken.substring(0, 20)}...`);

    // Захватываем локи для ВСЕХ платформ ДО обновления статуса на 'scheduled'.
    // Это предотвращает гонку с планировщиком: если поставить статус 'pending' раньше
    // чем захватить лок — планировщик успевает подхватить платформы и дублирует публикацию.
    const preAcquiredLocks = new Set<string>();
    for (const platform of selectedPlatforms) {
      const acquired = await publicationLockManager.acquireLock(contentId, platform);
      if (acquired) {
        preAcquiredLocks.add(platform);
        log(`[Social Publishing] 🔒 Пре-захват блокировки для ${contentId}:${platform}`);
      } else {
        log(`[Social Publishing] ⚠️ Не удалось пре-захватить блокировку для ${contentId}:${platform} — платформа уже публикуется`);
      }
    }

    // Сначала сохраняем информацию о выбранных платформах в контент
    // Это очень важно - сохраняем структуру платформ перед публикацией
    const platformsData: Record<string, any> = {};

    selectedPlatforms.forEach(platform => {
      platformsData[platform] = {
        status: 'pending' // Начальный статус - ожидание публикации перед отправкой к N8N
      };
    });

    log(`[Social Publishing] Предварительно заполняем social_platforms со статусом "pending": ${JSON.stringify(platformsData)}`);

    try {
      log(`[Social Publishing] Обновляем статусы платформ для контента ${contentId} с DIRECTUS_TOKEN`);

      // Обновляем контент, чтобы сохранить выбранные платформы и сразу переводим в статус 'scheduled'
      const updatedContent = await storage.updateCampaignContent(
        contentId,
        {
          status: 'scheduled', // Устанавливаем статус 'scheduled' сразу при запуске публикации "Опубликовать сейчас"
          socialPlatforms: platformsData
        },
        adminToken
      );

      if (!updatedContent) {
        log(`[Social Publishing] Ошибка при сохранении выбранных платформ для контента ${contentId}`);
        return res.status(500).json({
          success: false,
          error: 'Не удалось сохранить выбранные платформы'
        });
      }

      log(`[Social Publishing] Успешно сохранены выбранные платформы для контента ${contentId}`);
      console.log(`✅ [PUBLISH-NOW] Platforms saved for ${contentId}, starting publication to: ${selectedPlatforms.join(', ')}`);

      // Запускаем публикацию в каждую выбранную платформу
      const publishResults = [];

      log(`[Social Publishing] 🚀 НАЧАЛО ПУБЛИКАЦИИ: contentId=${contentId}, платформы=${selectedPlatforms.join(', ')}, количество=${selectedPlatforms.length}`);
      console.log(`🚀 [PUBLISH-NOW] Starting publication loop for ${selectedPlatforms.length} platforms`);

      for (const platform of selectedPlatforms) {
        log(`[Social Publishing] 📤 Обработка платформы: ${platform}`);
        try {
          // TikTok временно отключён
          if (platform === 'tiktok') {
            log(`[Social Publishing] TikTok временно отключён, пропускаем`);
            publishResults.push({ platform: 'tiktok', success: false, error: 'TikTok временно отключён' });
            await publicationLockManager.releaseLock(contentId, platform);
            continue;
          }

          // Проверяем, поддерживается ли эта платформа
          if (!['telegram', 'vk', 'instagram', 'facebook', 'youtube', 'threads'].includes(platform)) {
            publishResults.push({
              platform,
              success: false,
              error: `Платформа ${platform} не поддерживается`
            });
            continue;
          }

          // КРИТИЧЕСКАЯ ЗАЩИТА: Проверяем блокировку для предотвращения дублирования.
          // Если лок уже был пре-захвачен выше — используем его напрямую.
          // Если нет (платформа не была в preAcquiredLocks) — пробуем захватить сейчас.
          if (!preAcquiredLocks.has(platform)) {
            const lockAcquired = await publicationLockManager.acquireLock(contentId, platform);
            if (!lockAcquired) {
              log(`[Social Publishing] 🔒 Блокировка уже установлена для ${contentId}:${platform}, пропускаем`);
              publishResults.push({
                platform,
                success: false,
                error: `Публикация уже выполняется для платформы ${platform}`
              });
              continue;
            }
          }

          log(`[Social Publishing] Запускаем публикацию контента ${contentId} в ${platform}`);

          // Threads публикуется напрямую через API (без N8N)
          if (platform === 'threads') {
            log(`[Social Publishing] Threads — прямая публикация через API`);
            try {
              const directusUrl = process.env.DIRECTUS_URL;
              const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
                headers: { Authorization: `Bearer ${adminToken}` }
              });
              const contentItem = contentResponse.data.data;
              const campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${contentItem.campaign_id}`, {
                headers: { Authorization: `Bearer ${adminToken}` }
              });
              const threadsSettings = campaignResponse.data.data.social_media_settings?.threads;

              if (!threadsSettings?.accessToken || !threadsSettings?.threadsUserId) {
                throw new Error('Threads не настроен для этой кампании');
              }

              const { threadsService } = await import('../services/social-platforms/threads-service');
              const rawText = contentItem.text_content || contentItem.content || contentItem.title || '';
              const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
              const imageUrl = contentItem.image_url || undefined;
              const videoUrl = contentItem.video_url || undefined;

              log(`[Social Publishing] Threads text source: text_content=${!!contentItem.text_content}, content=${!!contentItem.content}, title=${!!contentItem.title}, length=${text.length}`);
              const publishResult = await threadsService.publishPost(threadsSettings, { text, imageUrl, videoUrl });

              if (publishResult.success) {
                await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
                  social_platforms: {
                    ...(contentItem.social_platforms || {}),
                    threads: {
                      status: 'published',
                      postId: publishResult.postId,
                      postUrl: publishResult.postUrl,
                      publishedAt: new Date().toISOString()
                    }
                  }
                }, { headers: { Authorization: `Bearer ${adminToken}` } });

                publishResults.push({ platform, success: true, result: publishResult });
              } else {
                throw new Error(publishResult.error || 'Ошибка публикации в Threads');
              }
            } catch (threadsErr: any) {
              log(`[Social Publishing] Ошибка Threads: ${threadsErr.message}`);
              // Retry-логика: до 3 попыток через 5 минут, после — окончательный failed
              const MAX_RETRIES = 3;
              const RETRY_DELAY_MIN = 5;
              try {
                const failedContentResponse = await axios.get(`${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`, {
                  headers: { Authorization: `Bearer ${adminToken}` }
                });
                const failedContent = failedContentResponse.data.data;
                const currentPlatforms = failedContent.social_platforms || {};
                const existing = currentPlatforms['threads'] || {};
                const retryCount = (existing.retryCount || 0) as number;
                const now = new Date();
                let threadsUpdate: Record<string, any>;
                if (retryCount < MAX_RETRIES) {
                  const nextRetry = new Date(now.getTime() + RETRY_DELAY_MIN * 60 * 1000);
                  threadsUpdate = { ...existing, status: 'pending', scheduledAt: nextRetry.toISOString(), retryCount: retryCount + 1, lastError: threadsErr.message, retriedAt: now.toISOString() };
                  log(`[Social Publishing] Threads retry ${retryCount + 1}/${MAX_RETRIES} scheduled at ${nextRetry.toISOString()}`);
                } else {
                  threadsUpdate = { ...existing, status: 'failed', error: threadsErr.message, failedAt: now.toISOString(), retryCount };
                  log(`[Social Publishing] Threads exhausted retries — marking failed`);
                }
                await axios.patch(`${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`, {
                  social_platforms: { ...currentPlatforms, threads: threadsUpdate }
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
              } catch (updateErr: any) {
                log(`[Social Publishing] Не удалось обновить retry-статус Threads: ${updateErr.message}`);
              }
              publishResults.push({ platform, success: false, error: threadsErr.message });
            }
            await publicationLockManager.releaseLock(contentId, platform);
            continue;
          }

          // Facebook публикуется напрямую через API (без N8N)
          if (platform === 'facebook') {
            log(`[Social Publishing] Facebook — прямая публикация через API`);
            try {
              const directusUrl = process.env.DIRECTUS_URL;
              const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
                headers: { Authorization: `Bearer ${adminToken}` }
              });
              const contentItem = contentResponse.data.data;
              const campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${contentItem.campaign_id}`, {
                headers: { Authorization: `Bearer ${adminToken}` }
              });
              const fbSettings = campaignResponse.data.data.social_media_settings?.facebook;

              if (!fbSettings?.token || !fbSettings?.pageId) {
                throw new Error('Facebook не настроен для этой кампании');
              }

              const { facebookService } = await import('../services/social-platforms/facebook-service');
              const rawText = contentItem.text_content || contentItem.content || contentItem.title || '';
              const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
              const imageUrl = contentItem.image_url || undefined;
              const videoUrl = contentItem.video_url || undefined;

              log(`[Social Publishing] Facebook text length=${text.length}, imageUrl=${!!imageUrl}`);
              const publishResult = await facebookService.publishPost(fbSettings, { text, imageUrl, videoUrl });

              if (publishResult.success) {
                await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
                  social_platforms: {
                    ...(contentItem.social_platforms || {}),
                    facebook: {
                      status: 'published',
                      postId: publishResult.postId,
                      postUrl: publishResult.postUrl,
                      publishedAt: new Date().toISOString()
                    }
                  }
                }, { headers: { Authorization: `Bearer ${adminToken}` } });

                publishResults.push({ platform, success: true, result: publishResult });
              } else {
                throw new Error(publishResult.error || 'Ошибка публикации в Facebook');
              }
            } catch (fbErr: any) {
              log(`[Social Publishing] Ошибка Facebook: ${fbErr.message}`);
              const MAX_RETRIES = 3;
              const RETRY_DELAY_MIN = 5;
              try {
                const failedContentResponse = await axios.get(`${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`, {
                  headers: { Authorization: `Bearer ${adminToken}` }
                });
                const failedContent = failedContentResponse.data.data;
                const currentPlatforms = failedContent.social_platforms || {};
                const existing = currentPlatforms['facebook'] || {};
                const retryCount = (existing.retryCount || 0) as number;
                const now = new Date();
                let fbUpdate: Record<string, any>;
                if (retryCount < MAX_RETRIES) {
                  const nextRetry = new Date(now.getTime() + RETRY_DELAY_MIN * 60 * 1000);
                  fbUpdate = { ...existing, status: 'pending', scheduledAt: nextRetry.toISOString(), retryCount: retryCount + 1, lastError: fbErr.message, retriedAt: now.toISOString() };
                  log(`[Social Publishing] Facebook retry ${retryCount + 1}/${MAX_RETRIES} scheduled at ${nextRetry.toISOString()}`);
                } else {
                  fbUpdate = { ...existing, status: 'failed', error: fbErr.message, failedAt: now.toISOString(), retryCount };
                  log(`[Social Publishing] Facebook exhausted retries — marking failed`);
                }
                await axios.patch(`${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`, {
                  social_platforms: { ...currentPlatforms, facebook: fbUpdate }
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
              } catch (updateErr: any) {
                log(`[Social Publishing] Не удалось обновить retry-статус Facebook: ${updateErr.message}`);
              }
              publishResults.push({ platform, success: false, error: fbErr.message });
            }
            await publicationLockManager.releaseLock(contentId, platform);
            continue;
          }

          // Telegram публикуется напрямую (без N8N)
          if (platform === 'telegram') {
            log(`[Social Publishing] Telegram — прямая публикация через Bot API`);
            try {
              const directusUrl = process.env.DIRECTUS_URL;
              const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, { headers: { Authorization: `Bearer ${adminToken}` } });
              const contentItem = contentResponse.data.data;
              const campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${contentItem.campaign_id}`, { headers: { Authorization: `Bearer ${adminToken}` } });
              const tgSettings = campaignResponse.data.data.social_media_settings?.telegram;
              if (!tgSettings?.token || !tgSettings?.chatId) throw new Error('Telegram не настроен для этой кампании');
              const { telegramService } = await import('../services/social-platforms/telegram-service');
              const rawText = contentItem.text_content || contentItem.content || contentItem.title || '';
              const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
              const publishResult = await telegramService.publishPost(tgSettings, {
                text,
                imageUrl: contentItem.image_url,
                additionalImages: contentItem.additional_images,
                videoUrl: contentItem.video_url,
              });
              if (publishResult.success) {
                await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
                  social_platforms: { ...(contentItem.social_platforms || {}), telegram: { status: 'published', postId: String(publishResult.messageId || ''), postUrl: publishResult.postUrl, publishedAt: new Date().toISOString() } }
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                publishResults.push({ platform, success: true, result: publishResult });
              } else { throw new Error(publishResult.error || 'Ошибка Telegram API'); }
            } catch (tgErr: any) {
              log(`[Social Publishing] Ошибка Telegram: ${tgErr.message}`);
              publishResults.push({ platform, success: false, error: tgErr.message });
            }
            await publicationLockManager.releaseLock(contentId, platform);
            continue;
          }

          // VK публикуется напрямую (без N8N)
          if (platform === 'vk') {
            log(`[Social Publishing] VK — прямая публикация через VK API`);
            try {
              const directusUrl = process.env.DIRECTUS_URL;
              const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, { headers: { Authorization: `Bearer ${adminToken}` } });
              const contentItem = contentResponse.data.data;
              const campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${contentItem.campaign_id}`, { headers: { Authorization: `Bearer ${adminToken}` } });
              let vkSettings = campaignResponse.data.data.social_media_settings?.vk;
              if (!vkSettings?.token) throw new Error('VK не настроен для этой кампании: отсутствует access_token. Подключите VK в настройках кампании.');
              if (!vkSettings?.groupId) {
                log(`[Social Publishing] VK: groupId не задан — сервис попробует авто-определить группу`);
              }
              // Проактивный refresh токена перед каждой публикацией
              const vkClientIdRouter1 = vkSettings.clientId || process.env.VK_APP_ID || null;
              if (vkSettings.refreshToken && vkClientIdRouter1) {
                try {
                  log(`[Social Publishing] VK: обновляем токен перед публикацией для кампании ${contentItem.campaign_id}`);
                  const { refreshAndSaveVkToken } = await import('../services/vk-token-refresh');
                  const newToken = await refreshAndSaveVkToken(contentItem.campaign_id, { ...vkSettings, clientId: vkClientIdRouter1 });
                  if (newToken) {
                    vkSettings = { ...vkSettings, token: newToken, accessToken: newToken, clientId: vkClientIdRouter1 };
                    log(`[Social Publishing] VK: токен успешно обновлён`);
                  }
                } catch (refErr: any) {
                  log(`[Social Publishing] VK: refresh перед публикацией не удался: ${refErr.message}`, undefined, 'warn');
                }
              }
              const { vkService } = await import('../services/social-platforms/vk-service');
              const rawText = contentItem.text_content || contentItem.content || contentItem.title || '';
              const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
              const publishResult = await vkService.publishPost(vkSettings, {
                text,
                imageUrl: contentItem.image_url || contentItem.imageUrl || contentItem.featured_image || undefined,
                additionalImages: contentItem.additional_images ?? contentItem.additionalImages ?? [],
                videoUrl: contentItem.video_url || contentItem.videoUrl || undefined
              });
              if (publishResult.success) {
                await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
                  social_platforms: { ...(contentItem.social_platforms || {}), vk: { status: 'published', postId: String(publishResult.postId || ''), postUrl: publishResult.postUrl, publishedAt: new Date().toISOString() } }
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                publishResults.push({ platform, success: true, result: publishResult });
              } else if ((publishResult as any).tokenExpired) {
                // Токен истёк — сохраняем специальный статус и подсказку пользователю
                const campaignId = contentItem.campaign_id;
                const errMsg = `Токен ВКонтакте истёк. Обновите его в настройках кампании.`;
                await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
                  social_platforms: { ...(contentItem.social_platforms || {}), vk: { status: 'failed', error: errMsg, tokenExpired: true, failedAt: new Date().toISOString(), campaignId } }
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                log(`[Social Publishing] VK токен истёк для кампании ${campaignId}`);
                publishResults.push({ platform, success: false, error: errMsg });
              } else { throw new Error(publishResult.error || 'Ошибка VK API'); }
            } catch (vkErr: any) {
              log(`[Social Publishing] Ошибка VK: ${vkErr.message}`);
              publishResults.push({ platform, success: false, error: vkErr.message });
            }
            await publicationLockManager.releaseLock(contentId, platform);
            continue;
          }

          // Instagram публикуется напрямую (без N8N)
          if (platform === 'instagram') {
            log(`[Social Publishing] Instagram — прямая публикация через Graph API`);
            try {
              const directusUrl = process.env.DIRECTUS_URL;
              const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, { headers: { Authorization: `Bearer ${adminToken}` } });
              const contentItem = contentResponse.data.data;

              // Защита от дублирования: если уже опубликовано — не запускаем снова
              const existingIg = contentItem.social_platforms?.instagram;
              if (existingIg?.status === 'published' && existingIg?.postUrl) {
                log(`[Social Publishing] Instagram уже опубликован (${existingIg.postUrl}), пропускаем`);
                publishResults.push({ platform, success: true, result: { postId: existingIg.postId, postUrl: existingIg.postUrl } });
                await publicationLockManager.releaseLock(contentId, platform);
                continue;
              }

              const campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${contentItem.campaign_id}`, { headers: { Authorization: `Bearer ${adminToken}` } });
              const igSettings = campaignResponse.data.data.social_media_settings?.instagram;
              if ((!igSettings?.accessToken && !igSettings?.token) || !igSettings?.businessAccountId) throw new Error('Instagram не настроен для этой кампании');
              const { instagramService } = await import('../services/social-platforms/instagram-service');
              const rawText = contentItem.text_content || contentItem.content || contentItem.title || '';
              const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
              const publishResult = await instagramService.publishPost(igSettings, { text, imageUrl: contentItem.image_url, videoUrl: contentItem.video_url }, contentId, adminToken);
              if (publishResult.success) {
                await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
                  social_platforms: { ...(contentItem.social_platforms || {}), instagram: { status: 'published', postId: publishResult.postId, postUrl: publishResult.postUrl, publishedAt: new Date().toISOString() } }
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                publishResults.push({ platform, success: true, result: publishResult });
              } else { throw new Error(publishResult.error || 'Ошибка Instagram API'); }
            } catch (igErr: any) {
              log(`[Social Publishing] Ошибка Instagram: ${igErr.message}`);
              publishResults.push({ platform, success: false, error: igErr.message });
            }
            await publicationLockManager.releaseLock(contentId, platform);
            continue;
          }

          // YouTube публикуется напрямую (без N8N)
          if (platform === 'youtube') {
            log(`[Social Publishing] YouTube — прямая публикация через YouTube Data API v3`);
            try {
              // Определяем тип: Shorts (clip) или обычное видео
              const ytContentResp = await axios.get(`${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`, { headers: { Authorization: `Bearer ${adminToken}` } });
              const ytContentType = (ytContentResp.data?.data?.content_type || '').toLowerCase();
              const isYtShorts = ['clip', 'short', 'shorts', 'short_video', 'reel'].includes(ytContentType);
              let ytResult: { success: boolean; videoId?: string; videoUrl?: string; error?: string };
              if (isYtShorts) {
                const { youtubeShortsService } = await import('../services/social-platforms/youtube-shorts-service');
                log(`[Social Publishing] YouTube Shorts (content_type=${ytContentType})`);
                ytResult = await youtubeShortsService.publishShort(contentId, adminToken);
              } else {
                const { youtubeVideoService } = await import('../services/social-platforms/youtube-video-service');
                log(`[Social Publishing] YouTube Video (content_type=${ytContentType})`);
                ytResult = await youtubeVideoService.publishVideo(contentId, adminToken);
              }
              if (ytResult.success) {
                log(`[Social Publishing] YouTube опубликовано: ${ytResult.videoUrl}`);
                publishResults.push({ platform, success: true, result: { videoId: ytResult.videoId, videoUrl: ytResult.videoUrl } });
              } else {
                throw new Error(ytResult.error || 'Ошибка публикации YouTube');
              }
            } catch (ytErr: any) {
              log(`[Social Publishing] Ошибка YouTube: ${ytErr.message}`);
              // Пишем failed-статус в Directus
              try {
                const freshResp = await axios.get(`${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`, {
                  headers: { Authorization: `Bearer ${adminToken}` }
                });
                const freshPlatforms = freshResp.data?.data?.social_platforms || {};
                await axios.patch(`${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`, {
                  social_platforms: { ...freshPlatforms, youtube: { ...(freshPlatforms.youtube || {}), status: 'failed', error: ytErr.message, failedAt: new Date().toISOString() } }
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
              } catch {}
              publishResults.push({ platform, success: false, error: ytErr.message });
            }
            await publicationLockManager.releaseLock(contentId, platform);
            continue;
          }

          // Платформа не поддерживается напрямую
          log(`[Social Publishing] Платформа ${platform} не поддерживается для прямой публикации`);
          publishResults.push({
            platform,
            success: false,
            error: `Платформа ${platform} не поддерживается`
          });

          // Освобождаем блокировку после успешной публикации
          await publicationLockManager.releaseLock(contentId, platform);
        } catch (error: any) {
          log(`[Social Publishing] Ошибка при публикации в ${platform}: ${error.message}`);

          // Освобождаем блокировку при ошибке
          await publicationLockManager.releaseLock(contentId, platform);

          publishResults.push({
            platform,
            success: false,
            error: error.message
          });
        }
      }

      // Проверяем, есть ли успешные публикации и неудачные публикации
      const hasSuccessfulPublications = publishResults.some(result => result.success);
      const hasFailedPublications = publishResults.some(result => !result.success);
      // Исправленная логика: определяем количество выбранных платформ правильно
      const selectedPlatformsCount = Array.isArray(platforms)
        ? platforms.length
        : Object.entries(platforms).filter(([_, selected]) => selected === true).length;

      const allPlatformsPublished = hasSuccessfulPublications && !hasFailedPublications && publishResults.length === selectedPlatformsCount;

      log(`[Social Publishing] Статус публикаций: успешных=${hasSuccessfulPublications}, неудачных=${hasFailedPublications}, все платформы опубликованы=${allPlatformsPublished} (выбрано: ${selectedPlatformsCount}, результатов: ${publishResults.length})`);

      if (hasSuccessfulPublications) {
        try {
          const successfulPlatforms = publishResults.filter(r => r.success).map(r => r.platform);
          const failedPlatformsArr = publishResults.filter(r => !r.success).map(r => r.platform);
          let freshContent: Record<string, any> = {};
          let finalContentStatus = failedPlatformsArr.length === 0
            ? 'published'
            : 'partially_published';
          let aggregatePublishedAt: string | null = null;

          // Platform handlers have already persisted their own fresh state. Do
          // not write social_platforms again here: rebuilding it from the result
          // list used to downgrade "published" to "publishing" and erase fields
          // written by an earlier platform.
          try {
            const freshResp = await axios.get(
              `${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`,
              { headers: { Authorization: `Bearer ${adminToken}` } },
            );
            freshContent = freshResp.data?.data || {};
            const freshPlatforms = freshContent.social_platforms || {};
            finalContentStatus = getContentPublicationStatus(
              freshPlatforms,
              freshContent.status || finalContentStatus,
            );
            aggregatePublishedAt = getContentAggregateTimes(
              freshPlatforms,
              finalContentStatus,
              {
                scheduledAt: freshContent.scheduled_at,
                publishedAt: freshContent.published_at,
              },
            ).publishedAt;
          } catch (freshStateError: any) {
            // A transient read failure must not leave successfully published
            // content in its pre-publication status.
            log(`[Social Publishing] Не удалось перечитать статус ${contentId}: ${freshStateError.message}`);
          }

          const publishedAt = finalContentStatus === 'published'
            ? aggregatePublishedAt || new Date()
            : null;

          await storage.updateCampaignContent(
            contentId,
            {
              status: finalContentStatus,
              publishedAt,
            },
            adminToken,
          );

          const requestUserId = (req as any).user?.id || freshContent.user_id;
          const campaignId = typeof freshContent.campaign_id === 'object'
            ? freshContent.campaign_id?.id
            : freshContent.campaign_id;
          if (requestUserId) invalidateContentCache(String(requestUserId), campaignId ? String(campaignId) : undefined);

          log(
            `[Social Publishing] Контент ${contentId}: status=${finalContentStatus}, ` +
            `publishedAt=${publishedAt instanceof Date ? publishedAt.toISOString() : publishedAt}, ` +
            `успешные платформы=${successfulPlatforms.join(', ')}`,
          );
        } catch (statusError: any) {
          log(`[Social Publishing] Ошибка при обновлении статуса контента: ${statusError.message}`);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Контент отправлен на публикацию в выбранные платформы',
        results: publishResults
      });
    } catch (error: any) {
      log(`[Social Publishing] Критическая ошибка при публикации: ${error.message}`);

      return res.status(500).json({
        success: false,
        error: `Внутренняя ошибка сервера: ${error.message}`
      });
    }
  } catch (error: any) {
    log(`[Social Publishing] Глобальная ошибка при публикации: ${error.message}`);

    return res.status(500).json({
      success: false,
      error: `Внутренняя ошибка сервера: ${error.message}`
    });
  }
});

/**
 * @api {post} /api/publish Публикация контента в социальные сети
 * @apiDescription Публикует контент в выбранную социальную платформу (универсальный маршрут)
 * @apiVersion 1.0.0
 * @apiName PublishContent
 * @apiGroup SocialPublishing
 * 
 * @apiParam {String} contentId ID контента для публикации
 * @apiParam {String} platform Платформа для публикации (telegram, vk, instagram)
 * 
 * @apiSuccess {Boolean} success Статус операции
 * @apiSuccess {Object} result Результат публикации
 */
router.post('/publish', authMiddleware, async (req, res) => {
  try {

    const { contentId, platform } = req.body;

    if (!contentId || !platform) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId и platform'
      });
    }

    log(`[Social Publishing] Запрос на публикацию контента ${contentId} в ${platform}`);

    // Маршрутизация запросов в зависимости от платформы
    switch (platform.toLowerCase()) {
      case 'telegram':
        return res.status(501).json({ success: false, error: 'Используйте /api/social/publish/now для публикации в Telegram' });

      case 'vk':
        return res.status(501).json({ success: false, error: 'Используйте /api/social/publish/now для публикации в VK' });

      case 'instagram':
        return res.status(501).json({ success: false, error: 'Используйте /api/social/publish/now для публикации в Instagram' });

      case 'facebook':
        // Для Facebook используем прямую публикацию через API
        log(`[Social Publishing] Facebook публикации обрабатываются через прямой API, не через n8n`);
        // Формируем прямой запрос к facebook-webhook-direct
        try {
          // Получаем базовый URL приложения для формирования полного пути
          const appBaseUrl = process.env.APP_URL || `http://0.0.0.0:${process.env.PORT || 5000}`;
          const facebookWebhookUrl = `${appBaseUrl}/api/facebook-webhook-direct`;

          log(`[Social Publishing] Отправка запроса на Facebook webhook: ${facebookWebhookUrl}`);

          const response = await axios.post(facebookWebhookUrl, { contentId });

          log(`[Social Publishing] Успешный ответ от Facebook webhook-direct: ${JSON.stringify(response.data)}`);

          return res.status(200).json({
            success: true,
            message: `Контент успешно отправлен на публикацию в Facebook`,
            result: response.data
          });
        } catch (fbError: any) {
          log(`[Social Publishing] Ошибка при прямой публикации в Facebook: ${fbError.message}`);
          if (fbError.response?.data) {
            log(`[Social Publishing] Детали ошибки Facebook: ${JSON.stringify(fbError.response.data)}`);
          }
          return res.status(500).json({
            success: false,
            error: `Ошибка при публикации в Facebook: ${fbError.message}`
          });
        }

      case 'youtube':
        return res.status(501).json({ success: false, error: 'Используйте /api/social/publish/now для публикации в YouTube' });

      case 'threads': {
        log(`[Social Publishing] Threads публикация через прямой API`);
        try {
          const directusToken = req.user?.token || process.env.DIRECTUS_TOKEN;
          const directusUrl = process.env.DIRECTUS_URL;

          const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
            headers: { Authorization: `Bearer ${directusToken}` }
          });
          const contentItem = contentResponse.data.data;

          const campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${contentItem.campaign_id}`, {
            headers: { Authorization: `Bearer ${directusToken}` }
          });
          const threadsSettings = campaignResponse.data.data.social_media_settings?.threads;

          if (!threadsSettings?.accessToken || !threadsSettings?.threadsUserId) {
            return res.status(400).json({ success: false, error: 'Threads не настроен для этой кампании' });
          }

          const { threadsService } = await import('../services/social-platforms/threads-service');
          const rawText2 = contentItem.text_content || contentItem.content || contentItem.title || '';
          const text = typeof rawText2 === 'string' ? rawText2 : JSON.stringify(rawText2);
          const imageUrl = contentItem.image_url || undefined;
          const videoUrl = contentItem.video_url || undefined;

          log(`[Social Publishing] Threads text source: text_content=${!!contentItem.text_content}, content=${!!contentItem.content}, title=${!!contentItem.title}, length=${text.length}`);
          const publishResult = await threadsService.publishPost(threadsSettings, { text, imageUrl, videoUrl });

          if (publishResult.success) {
            await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
              social_platforms: {
                ...(contentItem.social_platforms || {}),
                threads: { status: 'published', postId: publishResult.postId, postUrl: publishResult.postUrl, publishedAt: new Date().toISOString() }
              }
            }, { headers: { Authorization: `Bearer ${directusToken}` } });

            return res.status(200).json({ success: true, message: 'Контент опубликован в Threads', postUrl: publishResult.postUrl });
          } else {
            return res.status(500).json({ success: false, error: publishResult.error || 'Ошибка публикации в Threads' });
          }
        } catch (threadsError: any) {
          log(`[Social Publishing] Ошибка при публикации в Threads: ${threadsError.message}`);
          return res.status(500).json({ success: false, error: `Ошибка при публикации в Threads: ${threadsError.message}` });
        }
      }

      default:
        return res.status(400).json({
          success: false,
          error: `Платформа ${platform} не поддерживается`
        });
    }
  } catch (error: any) {
    log(`[Social Publishing] Критическая ошибка: ${error.message}`);

    return res.status(500).json({
      success: false,
      error: `Внутренняя ошибка сервера: ${error.message}`
    });
  }
});

/**
 * Публикует контент через n8n вебхук
 * @param contentId ID контента для публикации
 * @param platform Платформа для публикации
 * @param req Исходный запрос
 * @param res Исходный ответ
 */
async function publishViaN8n(contentId: string, platform: string, req: express.Request, res: express.Response) {
  try {
    log(`[Social Publishing] Публикация контента ${contentId} в ${platform} через n8n вебхук`);

    // Маппинг платформ на соответствующие n8n вебхуки
    // YouTube убран — публикуется напрямую через YouTube Data API v3
    const webhookMap: Record<string, string> = {
      'telegram': 'publish-telegram',
      'vk': 'publish-vk',
      'instagram': 'publish-instagram',
      'facebook': 'publish-facebook'
    };

    const webhookName = webhookMap[platform];
    if (!webhookName) {
      return res.status(400).json({
        success: false,
        error: `Платформа ${platform} не имеет настроенного вебхука`
      });
    }

    // Формируем URL вебхука
    // ИСПРАВЛЕНО: Используем централизованную функцию getN8nUrl()
    const { getN8nUrl } = await import('../utils/n8n-utils');
    let baseUrl = getN8nUrl();

    // Логируем какой URL используется
    log(`[Social Publishing] Используемый N8N URL: ${baseUrl}`);
    log(`[Social Publishing] Используемый базовый URL для n8n: ${baseUrl}`);
    log(`[Social Publishing] Реальный contentId отправляемый в n8n: ${contentId}`);

    // Всегда добавляем /webhook если его нет
    if (!baseUrl.includes("/webhook")) {
      // Если baseUrl заканчивается на /, убираем его перед добавлением /webhook
      if (baseUrl.endsWith("/")) {
        baseUrl = baseUrl.slice(0, -1);
      }
      baseUrl = `${baseUrl}/webhook`;
    }
    // Убираем возможный слеш в конце базового URL
    const baseUrlWithoutTrailingSlash = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const webhookUrl = `${baseUrlWithoutTrailingSlash}/${webhookName}`;

    // Логируем URL для отладки
    log(`[Social Publishing] Сформирован URL для n8n webhook: ${webhookUrl}`);
    const webhookPayload = {
      contentId
    };

    const response = await axios.post(webhookUrl, webhookPayload);

    log(`[Social Publishing] Отправлены данные в n8n вебхук: contentId=${contentId}, platform=${platform}`);
    log(`[Social Publishing] Данные извлекаются из Directus по contentId`);

    log(`[Social Publishing] Ответ от n8n вебхука: ${JSON.stringify(response.data)}`);

    // Обновляем статус платформы после успешной публикации
    try {
      log(`[Social Publishing] Обновление статуса платформы ${platform} для контента ${contentId} на "published"`);

      // Получаем токен администратора
      const directusAuthManager = await import('../services/directus-auth-manager').then(m => m.directusAuthManager);
      let adminToken = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_SERVICE_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
      const sessions = directusAuthManager.getAllActiveSessions();

      if (sessions.length > 0) {
        adminToken = sessions[0].token;
      }

      // Получаем текущий контент
      const content = await storage.getCampaignContentById(contentId);

      if (!content || !content.socialPlatforms) {
        log(`[Social Publishing] Не удалось получить контент ${contentId} или нет настроек платформ`);
        return;
      }

      // Обновляем статус конкретной платформы
      const updatedPlatforms = { ...content.socialPlatforms };

      // Проверяем, есть ли данная платформа в настройках
      if (updatedPlatforms[platform]) {
        log(`[Social Publishing] Обновление статуса платформы ${platform} на published`);

        // Обновляем статус платформы на published
        updatedPlatforms[platform] = {
          ...updatedPlatforms[platform],
          status: 'published',
          publishedAt: new Date()
        };

        // Сохраняем обновленные настройки платформ
        await storage.updateCampaignContent(
          contentId,
          { socialPlatforms: updatedPlatforms },
          adminToken
        );

        log(`[Social Publishing] Статус платформы ${platform} успешно обновлен на "published"`);

        // Проверяем, все ли выбранные платформы опубликованы
        const selectedPlatforms = Object.entries(updatedPlatforms)
          .filter(([_, data]) => data.selected === true)
          .map(([platform]) => platform);

        const publishedSelectedPlatforms = Object.entries(updatedPlatforms)
          .filter(([_, data]) => data.selected === true && data.status === 'published')
          .map(([platform]) => platform);

        log(`[Social Publishing] Статусы выбранных платформ: опубликовано ${publishedSelectedPlatforms.length}/${selectedPlatforms.length}`);

        // Обновляем общий статус, если все выбранные платформы опубликованы
        if (selectedPlatforms.length > 0 && publishedSelectedPlatforms.length === selectedPlatforms.length) {
          log(`[Social Publishing] Все выбранные платформы опубликованы, обновляем общий статус на published`);

          await storage.updateCampaignContent(
            contentId,
            { status: 'published', publishedAt: new Date() },
            adminToken
          );

          log(`[Social Publishing] Общий статус контента обновлен на "published"`);
        } else if (content.status === 'draft') {
          // Если контент в статусе draft, обновляем его до scheduled
          log(`[Social Publishing] Контент в статусе draft, обновляем до scheduled для отслеживания прогресса`);

          await storage.updateCampaignContent(
            contentId,
            { status: 'scheduled' },
            adminToken
          );
        }
      } else {
        log(`[Social Publishing] Платформа ${platform} не найдена в настройках контента ${contentId}`);
      }

      // Дополнительно вызываем маршрут обновления статуса после публикации
      try {
        const appBaseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`;
        log(`[Social Publishing] Автоматический вызов обновления статуса после публикации в ${platform}`);

        await axios.post(
          `${appBaseUrl}/api/publish/update-status`,
          { contentId },
          {
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        log(`[Social Publishing] Успешный вызов обновления статуса после публикации в ${platform}`);
      } catch (updateStatusError: any) {
        log(`[Social Publishing] Ошибка при вызове обновления статуса: ${updateStatusError.message}`);
        // Продолжаем даже при ошибке обновления статуса
      }
    } catch (statusError: any) {
      log(`[Social Publishing] Ошибка при обновлении статуса платформы: ${statusError.message}`);
      // Продолжаем даже при ошибке обновления статуса
    }

    return res.status(200).json({
      success: true,
      message: `Контент успешно отправлен на публикацию в ${platform}`,
      result: response.data
    });
  } catch (error: any) {
    log(`[Social Publishing] Ошибка при публикации через n8n: ${error.message}`);
    if (error.response) {
      log(`[Social Publishing] Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }

    return res.status(500).json({
      success: false,
      error: `Ошибка при публикации через n8n: ${error.message}`
    });
  }
}

/**
 * Асинхронно публикует контент через n8n вебхук и возвращает результат (для использования с Promise)
 * @param contentId ID контента для публикации
 * @param platform Платформа для публикации
 * @returns Результат публикации
 */
async function publishViaN8nAsync(contentId: string, platform: string): Promise<any> {
  try {
    // ВСЕ платформы идут через N8N вебхуки - никаких исключений!

    // Стандартная логика для других платформ через n8n
    log(`[Social Publishing] Асинхронная публикация контента ${contentId} в ${platform} через n8n вебхук`);

    // Маппинг платформ на соответствующие n8n вебхуки
    // YouTube убран — публикуется напрямую через YouTube Data API v3
    const webhookMap: Record<string, string> = {
      'telegram': 'publish-telegram',
      'vk': 'publish-vk',
      'instagram': 'publish-instagram',
      'facebook': 'publish-facebook'
    };

    const webhookName = webhookMap[platform];

    if (!webhookName) {
      throw new Error(`Платформа ${platform} не имеет настроенного вебхука`);
    }

    // Формируем URL вебхука
    // ИСПРАВЛЕНО: Используем централизованную функцию getN8nUrl() для правильного URL
    const { getN8nUrl } = await import('../utils/n8n-utils');
    const n8nUrl = getN8nUrl();
    const baseUrl = `${n8nUrl}/webhook`;
    // Убираем возможный слеш в конце базового URL
    const baseUrlWithoutTrailingSlash = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const webhookUrl = `${baseUrlWithoutTrailingSlash}/${webhookName}`;

    console.log(`🚀 [PUBLISH-NOW-N8N] Calling: ${webhookUrl} for content ${contentId}, platform: ${platform}`);

    // Логируем URL для отладки
    log(`[Social Publishing] Сформирован URL для n8n webhook: ${webhookUrl}`);
    const webhookPayload = {
      contentId
    };

    let response;
    try {
      response = await axios.post(webhookUrl, webhookPayload, { timeout: 30000 });
      console.log(`✅ [PUBLISH-NOW-N8N] Request successful to ${webhookUrl}, status: ${response.status}`);
    } catch (axiosError: any) {
      console.log(`❌ [PUBLISH-NOW-N8N] Request failed to ${webhookUrl}: ${axiosError.message}`);
      if (axiosError.response) {
        console.log(`❌ [PUBLISH-NOW-N8N] Response status: ${axiosError.response.status}, data: ${JSON.stringify(axiosError.response.data)}`);
      }
      throw axiosError;
    }

    log(`[Social Publishing] Отправлены данные в n8n вебхук: contentId=${contentId}, platform=${platform}`);
    log(`[Social Publishing] Данные извлекаются из Directus по contentId`);

    log(`[Social Publishing] Вебхук n8n принял запрос для ${platform}`);

    return {
      success: true,
      message: `Контент успешно отправлен на публикацию в ${platform}`
    };
  } catch (error: any) {
    const rawMessage = error.message || '';
    const responseData = error.response?.data;
    const isHtml = typeof responseData === 'string' && responseData.includes('<');
    log(`[Social Publishing] Ошибка при публикации через n8n: ${rawMessage}`);
    if (error.response) {
      log(`[Social Publishing] Статус: ${error.response.status}, HTML-ответ: ${isHtml}`);
    }

    const cleanMessage = isHtml
      ? `N8N вернул ошибку (статус ${error.response?.status || 'неизвестен'})`
      : rawMessage;
    throw new Error(`Ошибка при публикации: ${cleanMessage}`);
  }
}

/**
 * Публикует карусель в Instagram через прямую интеграцию с API
 * @param contentId ID контента для публикации
 * @param req Исходный запрос
 * @param res Исходный ответ
 */
async function publishInstagramCarousel(contentId: string, req: express.Request, res: express.Response) {
  try {
    log(`[Social Publishing] Публикация карусели в Instagram для контента ${contentId}`);

    // Получаем необходимые данные для публикации карусели
    const { token, businessAccountId, caption, imageUrl, additionalImages } = req.body;

    // Проверяем наличие необходимых параметров
    if (!token || !businessAccountId) {
      return res.status(400).json({
        success: false,
        error: 'Для публикации карусели необходимо указать token и businessAccountId'
      });
    }

    // Собираем все изображения в массив
    const allImages = [imageUrl];
    if (additionalImages && Array.isArray(additionalImages)) {
      allImages.push(...additionalImages);
    }

    // Проверяем, что изображений достаточно для карусели
    if (allImages.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Для карусели необходимо минимум 2 изображения'
      });
    }

    // Публикуем карусель через Instagram Carousel API
    const result = await instagramCarouselHandler.publishCarousel(contentId, allImages, caption || '', token, businessAccountId);

    // Автоматически вызываем обновление статуса после публикации карусели
    try {
      const adminToken = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_SERVICE_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
      const appBaseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`;

      log(`[Social Publishing] Автоматический вызов обновления статуса после публикации карусели в Instagram`);

      await axios.post(
        `${appBaseUrl}/api/publish/update-status`,
        { contentId },
        {
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      log(`[Social Publishing] Успешный вызов обновления статуса после публикации карусели в Instagram`);
    } catch (updateStatusError: any) {
      log(`[Social Publishing] Ошибка при вызове обновления статуса после публикации карусели: ${updateStatusError.message}`);
      // Продолжаем даже при ошибке обновления статуса
    }

    return res.status(200).json({
      success: true,
      message: 'Запрос на публикацию карусели в Instagram обрабатывается',
      result
    });
  } catch (error: any) {
    log(`[Social Publishing] Ошибка при публикации карусели в Instagram: ${error.message}`);

    return res.status(500).json({
      success: false,
      error: `Ошибка при публикации карусели в Instagram: ${error.message}`
    });
  }
}

/**
 * @api {post} /api/publish/auto-update-status Автоматически обновить статус публикации
 * @apiDescription Автоматически проверяет статусы публикации во всех выбранных соцсетях и обновляет общий статус
 * @apiVersion 1.0.0
 * @apiName AutoUpdatePublicationStatus
 * @apiGroup SocialPublishing
 * 
 * @apiParam {String} contentId ID контента для проверки
 * 
 * @apiSuccess {Boolean} success Статус операции
 * @apiSuccess {Object} result Результат обновления статуса
 */
router.post('/publish/auto-update-status', authMiddleware, async (req, res) => {
  try {
    const { contentId } = req.body;

    if (!contentId) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId'
      });
    }

    log(`[Social Publishing] Запрос на автоматическое обновление статуса публикации для контента ${contentId}`);

    // Получаем токен для работы с Directus API
    const adminToken = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_SERVICE_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;

    // Получаем текущие данные контента через storage
    const content = await storage.getCampaignContentById(contentId, adminToken);

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Контент не найден'
      });
    }

    log(`[Social Publishing] Получен контент: ${JSON.stringify({
      id: content.id,
      status: content.status,
      hasSocialPlatforms: !!content.socialPlatforms,
      socialPlatformsType: content.socialPlatforms ? typeof content.socialPlatforms : 'undefined'
    })}`);

    // Проверяем, действительно ли все выбранные платформы опубликованы
    const socialPlatforms = content.socialPlatforms || {};

    // Получаем список выбранных платформ
    const selectedPlatforms = Object.entries(socialPlatforms)
      .filter(([_, platformData]) => platformData?.selected)
      .map(([platform, _]) => platform);

    // Получаем список опубликованных платформ
    const publishedPlatforms = Object.entries(socialPlatforms)
      .filter(([_, platformData]) => platformData?.selected && platformData?.status === 'published')
      .map(([platform, _]) => platform);

    // Получаем список платформ с ошибками
    const failedPlatforms = Object.entries(socialPlatforms)
      .filter(([_, platformData]) => platformData?.selected && (platformData?.status === 'failed' || platformData?.error))
      .map(([platform, _]) => platform);

    // Получаем список платформ в ожидании
    const pendingPlatforms = Object.entries(socialPlatforms)
      .filter(([_, platformData]) => platformData?.selected && platformData?.status !== 'published' && platformData?.status !== 'failed' && !platformData?.error)
      .map(([platform, _]) => platform);

    // Проверяем, что все выбранные платформы либо опубликованы, либо завершились с ошибкой
    // Если все платформы достигли финального статуса (нет pending), нужно обновить общий статус
    const allFinalized = pendingPlatforms.length === 0 && selectedPlatforms.length > 0;
    const allPublished = selectedPlatforms.length > 0 && selectedPlatforms.length === publishedPlatforms.length;

    log(`Проверка статуса: выбрано ${selectedPlatforms.length}, опубликовано ${publishedPlatforms.length}, с ошибками ${failedPlatforms.length}, в ожидании ${pendingPlatforms.length}, allFinalized=${allFinalized}, allPublished=${allPublished}`);

    // Обновляем статус на "published" если все выбранные платформы опубликованы,
    // ИЛИ если статус всех платформ финализирован (опубликованы или с ошибками) и есть хотя бы одна успешная публикация
    let newStatus = content.status; // по умолчанию оставляем текущий статус

    if (allPublished) {
      // Если все платформы опубликованы, ставим статус published
      newStatus = 'published';
      log(`[Social Publishing] Все платформы опубликованы, устанавливаем статус published`);
    } else if (allFinalized && publishedPlatforms.length > 0) {
      // Если все платформы завершили публикацию (либо успешно, либо с ошибкой) и есть хотя бы одна успешная, также ставим published
      newStatus = 'published';
      log(`[Social Publishing] Все платформы завершили публикацию, из них ${publishedPlatforms.length} успешно, ${failedPlatforms.length} с ошибками. Устанавливаем статус published`);
    }

    const updatedContent = await storage.updateCampaignContent(
      contentId,
      { status: newStatus, publishedAt: new Date() },
      adminToken
    );

    if (updatedContent) {
      log(`[Social Publishing] Успешно установлен статус "published" для контента ${contentId} (автоматически)`);
      return res.status(200).json({
        success: true,
        message: 'Контент автоматически отмечен как опубликованный',
        result: {
          contentId,
          status: 'published'
        }
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Не удалось обновить статус контента',
        error: 'Ошибка при обновлении статуса в Directus'
      });
    }
  } catch (error: any) {
    log(`[Social Publishing] Ошибка при автоматическом обновлении статуса: ${error.message}`);

    return res.status(500).json({
      success: false,
      error: `Внутренняя ошибка сервера: ${error.message}`
    });
  }
});

/**
 * @api {post} /api/publish/update-status Обновить статус публикации после публикации во все платформы
 * @apiDescription Проверяет статусы публикации во всех выбранных соцсетях и обновляет общий статус на "published"
 * @apiVersion 1.0.0
 * @apiName UpdatePublicationStatus
 * @apiGroup SocialPublishing
 * 
 * @apiParam {String} contentId ID контента для проверки
 * 
 * @apiSuccess {Boolean} success Статус операции
 * @apiSuccess {Object} result Результат обновления статуса
 */
router.post('/publish/update-status', authMiddleware, async (req, res) => {
  try {
    const { contentId } = req.body;

    if (!contentId) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId'
      });
    }

    log(`[Social Publishing] Запрос на обновление статуса публикации для контента ${contentId}`);

    // Получаем токен для работы с Directus API
    const adminToken = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_SERVICE_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;

    // Получаем текущие данные контента через storage
    const content = await storage.getCampaignContentById(contentId, adminToken);

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Контент не найден'
      });
    }

    log(`[Social Publishing] Получен контент: ${JSON.stringify({
      id: content.id,
      status: content.status,
      hasSocialPlatforms: !!content.socialPlatforms,
      socialPlatformsType: content.socialPlatforms ? typeof content.socialPlatforms : 'undefined'
    })}`);

    // Проверяем, есть ли данные о социальных платформах
    if (!content.socialPlatforms || typeof content.socialPlatforms !== 'object') {
      log(`[Social Publishing] Контент ${contentId} не имеет данных о социальных платформах`);
      return res.status(200).json({
        success: false,
        message: 'Контент не имеет данных о социальных платформах',
        result: {
          contentId,
          status: content.status || 'draft'
        }
      });
    }

    // Получаем список выбранных платформ и их статусы
    const platforms = content.socialPlatforms as Record<string, any>;
    const platformNames = Object.keys(platforms);

    if (platformNames.length === 0) {
      log(`[Social Publishing] Для контента ${contentId} не выбраны платформы для публикации`);

      // Если контент уже имеет статус "published", то не меняем его
      if (content.status === 'published') {
        return res.status(200).json({
          success: true,
          message: 'Контент уже опубликован',
          result: {
            contentId,
            status: 'published'
          }
        });
      }

      // Если платформы не указаны, но запрос пришел от нашего клиента,
      // все равно обновляем статус на "published"
      const updatedContent = await storage.updateCampaignContent(
        contentId,
        { status: 'published', publishedAt: new Date() },
        adminToken
      );

      if (updatedContent) {
        log(`[Social Publishing] Успешно установлен статус "published" для контента ${contentId} (без платформ)`);
        return res.status(200).json({
          success: true,
          message: 'Контент отмечен как опубликованный (без платформ)',
          result: {
            contentId,
            status: 'published'
          }
        });
      } else {
        return res.status(200).json({
          success: false,
          message: 'Не удалось обновить статус контента',
          result: {
            contentId,
            status: content.status || 'draft'
          }
        });
      }
    }

    log(`[Social Publishing] Проверка статусов публикации для контента ${contentId} в платформах: ${platformNames.join(', ')}`);

    // Проверяем статусы публикации в каждой платформе
    const platformStatuses = platformNames.map(name => {
      const platform = platforms[name];
      return {
        name,
        status: platform && platform.status ? platform.status : 'pending',
        published: platform && platform.status === 'published',
        failed: platform && (platform.status === 'failed' || platform.error),
        pending: platform && platform.status !== 'published' && platform.status !== 'failed' && !platform.error
      };
    });

    // Записываем информацию о статусах публикации
    const publishedPlatforms = platformStatuses.filter(p => p.published);
    const failedPlatforms = platformStatuses.filter(p => p.failed);
    const pendingPlatforms = platformStatuses.filter(p => p.pending);

    log(`[Social Publishing] Платформы с статусом published: ${publishedPlatforms.map(p => p.name).join(', ') || 'нет'}`);
    log(`[Social Publishing] Платформы с статусом failed: ${failedPlatforms.map(p => p.name).join(', ') || 'нет'}`);
    log(`[Social Publishing] Платформы с статусом pending: ${pendingPlatforms.map(p => p.name).join(', ') || 'нет'}`);

    // Проверяем, все ли выбранные платформы опубликованы
    const allPublished = publishedPlatforms.length === platformStatuses.length;
    // Проверяем, что все платформы достигли финального статуса (опубликованы или с ошибкой)
    const allFinalized = pendingPlatforms.length === 0;

    // Определяем, нужно ли обновить статус контента
    let shouldUpdateStatus = false;
    let newStatus = content.status; // по умолчанию оставляем текущий статус

    if (allPublished) {
      // Если все платформы опубликованы, ставим статус published
      shouldUpdateStatus = true;
      newStatus = 'published';
      log(`[Social Publishing] Все выбранные платформы опубликованы для контента ${contentId}, обновляем общий статус`);
    } else if (allFinalized && publishedPlatforms.length > 0) {
      // Если все платформы завершили публикацию (либо успешно, либо с ошибкой) и есть хотя бы одна успешная, также ставим published
      shouldUpdateStatus = true;
      newStatus = 'published';
      log(`[Social Publishing] Все платформы завершили публикацию, из них ${publishedPlatforms.length} успешно, ${failedPlatforms.length} с ошибками. Обновляем статус на published`);
    }

    if (shouldUpdateStatus) {
      // Обновляем общий статус контента на "published"
      const updatedContent = await storage.updateCampaignContent(
        contentId,
        { status: newStatus, publishedAt: new Date() },
        adminToken
      );

      if (updatedContent) {
        log(`[Social Publishing] Успешно обновлен общий статус контента ${contentId} на "${newStatus}"`);
        return res.status(200).json({
          success: true,
          message: `Общий статус публикации обновлен на "${newStatus}"`,
          result: {
            contentId,
            status: newStatus,
            platformStatuses
          }
        });
      } else {
        log(`[Social Publishing] Ошибка при обновлении общего статуса контента ${contentId}`);
        return res.status(500).json({
          success: false,
          error: 'Не удалось обновить общий статус контента'
        });
      }
    } else {
      log(`[Social Publishing] Не все платформы завершили публикацию для контента ${contentId}, статус не обновлен`);
      return res.status(200).json({
        success: false,
        message: 'Не все выбранные платформы завершили публикацию, общий статус не обновлен',
        result: {
          contentId,
          status: content.status,
          platformStatuses
        }
      });
    }
  } catch (error: any) {
    log(`[Social Publishing] Ошибка при обновлении статуса публикации: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: `Внутренняя ошибка сервера: ${error.message}`
    });
  }
});

/**
 * @api {get} /api/publish/diagnose Диагностика системы публикации
 * Проверяет переменные окружения, доступность N8N и токены
 */
router.get('/publish/diagnose', devOnly, authMiddleware, async (req, res) => {
  const { getN8nUrl } = await import('../utils/n8n-utils');
  const n8nUrl = getN8nUrl();
  const directusToken = process.env.DIRECTUS_TOKEN;
  const serviceToken = process.env.DIRECTUS_SERVICE_TOKEN;
  const adminToken = process.env.DIRECTUS_ADMIN_TOKEN;

  const diagnosis: any = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'unknown',
    n8n: {
      url: n8nUrl,
      configured: !!process.env.N8N_URL,
      reachable: false,
      error: null
    },
    // Не раскрываем даже префиксы токенов — только факт наличия.
    tokens: {
      DIRECTUS_TOKEN: !!directusToken,
      DIRECTUS_SERVICE_TOKEN: !!serviceToken,
      DIRECTUS_ADMIN_TOKEN: !!adminToken,
      hasAnyToken: !!(directusToken || serviceToken || adminToken)
    },
    directus: {
      url: process.env.DIRECTUS_URL || 'NOT SET'
    },
    webhooks: {
      telegram: `${n8nUrl}/webhook/publish-telegram`,
      instagram: `${n8nUrl}/webhook/publish-instagram`,
      vk: `${n8nUrl}/webhook/publish-vk`,
      facebook: `${n8nUrl}/webhook/publish-facebook`,
      youtube: `${n8nUrl}/webhook/publish-youtube`
    }
  };

  try {
    const testResponse = await fetch(`${n8nUrl}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    diagnosis.n8n.reachable = testResponse.ok;
    diagnosis.n8n.status = testResponse.status;
  } catch (err: any) {
    diagnosis.n8n.reachable = false;
    diagnosis.n8n.error = err.message;
  }

  log(`[Diagnose] Publishing system diagnosis: ${JSON.stringify(diagnosis, null, 2)}`);

  return res.json(diagnosis);
});

/**
 * @api {post} /api/publish/test-webhook Тест N8N webhook
 * Отправляет тестовый запрос на N8N webhook
 */
router.post('/publish/test-webhook', devOnly, authMiddleware, async (req, res) => {
  const { platform } = req.body;
  const { getN8nUrl } = await import('../utils/n8n-utils');
  const n8nUrl = getN8nUrl();
  const webhookUrl = `${n8nUrl}/webhook/publish-stories`;

  log(`[Test Webhook] Testing webhook: ${webhookUrl}`);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentId: 'test-diagnosis'
      }),
      signal: AbortSignal.timeout(10000)
    });

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    log(`[Test Webhook] Response from ${webhookUrl}: ${response.status} - ${responseText}`);

    return res.json({
      success: response.ok,
      webhookUrl,
      status: response.status,
      response: responseData
    });
  } catch (err: any) {
    log(`[Test Webhook] Error testing ${webhookUrl}: ${err.message}`);
    return res.json({
      success: false,
      webhookUrl,
      error: err.message
    });
  }
});

/**
 * @api {post} /api/social/retry-platform Повторная публикация одной платформы
 * @apiDescription Повторяет публикацию конкретной платформы для контента со статусом failed
 */
router.post('/retry-platform', authMiddleware, async (req, res) => {
  const { contentId, platform } = req.body;
  if (!contentId || !platform) {
    return res.status(400).json({ success: false, error: 'Необходимо указать contentId и platform' });
  }

  const validPlatforms = ['telegram', 'vk', 'instagram', 'facebook', 'youtube', 'threads'];
  if (!validPlatforms.includes(platform)) {
    return res.status(400).json({ success: false, error: `Неизвестная платформа: ${platform}` });
  }

  const directusUrl = process.env.DIRECTUS_URL;
  if (!directusUrl) return res.status(500).json({ success: false, error: 'DIRECTUS_URL не задан' });

  // Получаем admin токен
  let adminToken = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_SERVICE_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
  try {
    const { directusAuthManager } = await import('../services/directus-auth-manager');
    const userId = (req as any).user?.id;
    if (userId) {
      const validToken = await directusAuthManager.getValidToken(userId);
      if (validToken) adminToken = validToken;
    }
    if (!adminToken || adminToken === process.env.DIRECTUS_TOKEN) {
      const validAdminToken = await directusAuthManager.getAdminAuthToken();
      if (validAdminToken) adminToken = validAdminToken;
    }
  } catch (e) {
    log(`[Retry] Не удалось обновить токен: ${e}`);
  }

  if (!adminToken) return res.status(500).json({ success: false, error: 'Отсутствует токен Directus' });

  try {
    // Загружаем контент
    const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const contentItem = contentResponse.data.data;

    // Проверяем, что платформа находится в ретраябельном состоянии
    const platformStatus = contentItem.social_platforms?.[platform];
    const hasError = !!(platformStatus?.error || platformStatus?.lastError);
    const missingPostUrl = !platformStatus?.postUrl;
    const isRetryable =
      platformStatus?.status === 'failed' ||
      platformStatus?.status === 'error' ||
      (platformStatus?.status === 'pending' && hasError) ||
      // published без postUrl = тихий сбой; published с ошибкой = неконсистентное состояние
      (platformStatus?.status === 'published' && (missingPostUrl || hasError));
    if (!platformStatus || !isRetryable) {
      return res.status(400).json({ success: false, error: `Платформа ${platform} не готова к повторной публикации (статус: ${platformStatus?.status || 'не найдена'})` });
    }

    // Сбрасываем статус платформы на 'publishing', обнуляем счётчик retry
    const updatedPlatforms = {
      ...(contentItem.social_platforms || {}),
      [platform]: {
        ...platformStatus,
        status: 'publishing',
        retriedAt: new Date().toISOString(),
        retryCount: 0,          // сброс счётчика чтобы авто-ретрай тоже работал
        error: null,
        lastError: null
      }
    };
    await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
      social_platforms: updatedPlatforms
    }, { headers: { Authorization: `Bearer ${adminToken}` } });

    // Загружаем настройки кампании
    const campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${contentItem.campaign_id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const campaignSettings = campaignResponse.data.data.social_media_settings;

    const rawText = contentItem.text_content || contentItem.content || contentItem.title || '';
    const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);

    // Публикуем в зависимости от платформы
    if (platform === 'vk') {
      let vkSettings = campaignSettings?.vk;
      if (!vkSettings?.token) {
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), [platform]: { status: 'failed', error: 'VK не настроен: отсутствует access_token', failedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.status(400).json({ success: false, error: 'VK не настроен для этой кампании' });
      }
      // Проактивный refresh токена перед каждой публикацией
      const vkClientIdRouter2 = vkSettings.clientId || process.env.VK_APP_ID || null;
      if (vkSettings.refreshToken && vkClientIdRouter2) {
        try {
          log(`[Social Publishing] VK: обновляем токен перед публикацией для кампании ${contentItem.campaign_id}`);
          const { refreshAndSaveVkToken } = await import('../services/vk-token-refresh');
          const newToken = await refreshAndSaveVkToken(contentItem.campaign_id, { ...vkSettings, clientId: vkClientIdRouter2 });
          if (newToken) {
            vkSettings = { ...vkSettings, token: newToken, accessToken: newToken, clientId: vkClientIdRouter2 };
            log(`[Social Publishing] VK: токен успешно обновлён`);
          }
        } catch (refErr: any) {
          log(`[Social Publishing] VK: refresh перед публикацией не удался: ${refErr.message}`);
        }
      }
      const { vkService } = await import('../services/social-platforms/vk-service');
      const publishResult = await vkService.publishPost(vkSettings, {
        text,
        imageUrl: contentItem.image_url || contentItem.imageUrl || contentItem.featured_image || undefined,
        additionalImages: contentItem.additional_images ?? contentItem.additionalImages ?? [],
        videoUrl: contentItem.video_url || contentItem.videoUrl || undefined
      });
      if (publishResult.success) {
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), [platform]: { status: 'published', postId: String(publishResult.postId || ''), postUrl: publishResult.postUrl, publishedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.json({ success: true, platform, postUrl: publishResult.postUrl });
      } else if ((publishResult as any).tokenExpired) {
        const campaignId = contentItem.campaign_id;
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), [platform]: { status: 'failed', error: 'Токен ВКонтакте истёк. Обновите его в настройках кампании.', tokenExpired: true, failedAt: new Date().toISOString(), campaignId } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.json({ success: false, error: 'Токен ВКонтакте истёк', tokenExpired: true });
      } else {
        const errMsg = publishResult.error || 'Ошибка VK API';
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), [platform]: { status: 'failed', error: errMsg, failedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.json({ success: false, error: errMsg });
      }
    }

    if (platform === 'instagram') {
      const igSettings = campaignSettings?.instagram;
      if ((!igSettings?.accessToken && !igSettings?.token) || !igSettings?.businessAccountId) {
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), [platform]: { status: 'failed', error: 'Instagram не настроен для кампании', failedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.status(400).json({ success: false, error: 'Instagram не настроен для этой кампании' });
      }
      const { instagramService } = await import('../services/social-platforms/instagram-service');
      const publishResult = await instagramService.publishPost(igSettings, { text, imageUrl: contentItem.image_url, videoUrl: contentItem.video_url }, contentId, adminToken);
      if (publishResult.success) {
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), [platform]: { status: 'published', postId: publishResult.postId, postUrl: publishResult.postUrl, publishedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.json({ success: true, platform, postUrl: publishResult.postUrl });
      } else {
        const errMsg = publishResult.error || 'Ошибка Instagram API';
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), [platform]: { status: 'failed', error: errMsg, failedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.json({ success: false, error: errMsg });
      }
    }

    if (platform === 'telegram') {
      const tgSettings = campaignSettings?.telegram;
      const tgToken = tgSettings?.token || tgSettings?.botToken;
      const tgChatId = tgSettings?.chatId || tgSettings?.channelId;
      if (!tgToken || !tgChatId) {
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), [platform]: { status: 'failed', error: 'Telegram не настроен для кампании', failedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.status(400).json({ success: false, error: 'Telegram не настроен для этой кампании' });
      }
      const { telegramService } = await import('../services/social-platforms/telegram-service');
      const publishResult = await telegramService.publishPost({
        ...tgSettings,
        token: tgToken,
        chatId: tgChatId,
      }, {
        text,
        imageUrl: contentItem.image_url,
        additionalImages: contentItem.additional_images,
        videoUrl: contentItem.video_url,
      });
      if (publishResult.success) {
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), [platform]: { status: 'published', postId: String(publishResult.messageId || ''), postUrl: publishResult.postUrl, publishedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.json({ success: true, platform, postUrl: publishResult.postUrl });
      } else {
        const errMsg = publishResult.error || 'Ошибка Telegram API';
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), [platform]: { status: 'failed', error: errMsg, failedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.json({ success: false, error: errMsg });
      }
    }

    // Threads — прямой API (так же как в основном планировщике)
    if (platform === 'threads') {
      const threadsSettings = campaignSettings?.threads;
      if (!threadsSettings?.accessToken || !threadsSettings?.threadsUserId) {
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), threads: { status: 'failed', error: 'Threads не настроен для кампании', failedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.status(400).json({ success: false, error: 'Threads не настроен для этой кампании' });
      }
      const { threadsService } = await import('../services/social-platforms/threads-service');
      const rawText = contentItem.text_content || contentItem.content || contentItem.title || '';
      const textStr = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
      const publishResult = await threadsService.publishPost(threadsSettings, {
        text: textStr,
        imageUrl: contentItem.image_url || undefined,
        videoUrl: contentItem.video_url || undefined
      });
      if (publishResult.success) {
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), threads: { status: 'published', postId: publishResult.postId, postUrl: publishResult.postUrl, publishedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.json({ success: true, platform, postUrl: publishResult.postUrl });
      } else {
        const meta = publishResult.error || 'Ошибка Threads API';
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), threads: { status: 'failed', error: meta, failedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.json({ success: false, error: meta });
      }
    }

    // YouTube — прямая публикация через YouTube Data API v3
    if (platform === 'youtube') {
      const ytContentType = (contentItem.content_type || '').toLowerCase();
      const isYtShorts = ['clip', 'short', 'shorts', 'short_video', 'reel'].includes(ytContentType);
      let ytResult: { success: boolean; videoId?: string; videoUrl?: string; error?: string };
      if (isYtShorts) {
        const { youtubeShortsService } = await import('../services/social-platforms/youtube-shorts-service');
        log(`[Retry] YouTube Shorts (content_type=${ytContentType})`);
        ytResult = await youtubeShortsService.publishShort(contentId, adminToken);
      } else {
        const { youtubeVideoService } = await import('../services/social-platforms/youtube-video-service');
        log(`[Retry] YouTube Video (content_type=${ytContentType})`);
        ytResult = await youtubeVideoService.publishVideo(contentId, adminToken);
      }
      if (ytResult.success) {
        return res.json({ success: true, platform, postUrl: ytResult.videoUrl });
      } else {
        const errMsg = ytResult.error || 'Ошибка YouTube API';
        await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
          social_platforms: { ...(contentItem.social_platforms || {}), youtube: { status: 'failed', error: errMsg, failedAt: new Date().toISOString() } }
        }, { headers: { Authorization: `Bearer ${adminToken}` } });
        return res.json({ success: false, error: errMsg });
      }
    }

    // Прочие платформы не поддерживаются через этот эндпоинт
    return res.status(501).json({ success: false, error: `Используйте /api/social/publish/now для платформы ${platform}` });

  } catch (err: any) {
    log(`[Retry] Ошибка при повторной публикации в ${platform}: ${err.message}`);
    // Откатываем статус обратно на failed
    try {
      const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const contentItem = contentResponse.data.data;
      await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
        social_platforms: { ...(contentItem.social_platforms || {}), [platform]: { status: 'failed', error: err.message, failedAt: new Date().toISOString() } }
      }, { headers: { Authorization: `Bearer ${adminToken}` } });
    } catch (_) {}
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
