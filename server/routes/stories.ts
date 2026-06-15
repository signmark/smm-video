import express from 'express';
import axios from 'axios';
import { authenticateUser } from '../middleware/user-auth';
import { directusApi } from '../directus';
import { realVideoConverter } from '../services/real-video-converter';
import { vkStoriesService } from '../services/social-platforms/vk-stories-service';
import { vkClipsService } from '../services/social-platforms/vk-clips-service';
import { YouTubeService } from '../services/social-platforms/youtube-service';
import { socialPublishingService } from '../services/social';
import { generateStoriesImageServer } from '../services/stories-image-generator';
import { BegetS3StorageAws } from '../services/beget-s3-storage-aws';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { begetS3VideoService } from '../services/beget-s3-video-service';
import StoriesMediaService from '../services/stories-media-service';

const router = express.Router();

// Upload image to Cloudinary (Meta-accessible CDN for Instagram/Facebook)
async function uploadToExternalHost(imageBuffer: Buffer, filename: string): Promise<{ url: string; host: 'cloudinary' }> {
  const base64Image = imageBuffer.toString('base64');
  const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dc6bcrsyl';
  const cloudinaryUploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'My Unsigned Preset';

  const cloudinaryFormData = new FormData();
  cloudinaryFormData.append('file', `data:image/jpeg;base64,${base64Image}`);
  cloudinaryFormData.append('upload_preset', cloudinaryUploadPreset);
  cloudinaryFormData.append('folder', 'instagram-stories');

  const cloudinaryResponse = await axios.post(
    `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`,
    cloudinaryFormData,
    { timeout: 20000 }
  );

  if (cloudinaryResponse.data.secure_url) {
    console.log('[stories] Загружено на Cloudinary:', cloudinaryResponse.data.secure_url);
    return { url: cloudinaryResponse.data.secure_url, host: 'cloudinary' };
  }

  throw new Error('Не удалось загрузить изображение на Cloudinary');
}

let begetS3Storage: BegetS3StorageAws | null = null;
try {
  begetS3Storage = new BegetS3StorageAws();
} catch (e) {
  console.warn('[stories] Beget S3 не инициализирован:', (e as Error).message);
}

// Общая функция для обработки обновления simple story (используется в PUT и PATCH)
async function handleSimpleStoryUpdate(
  id: string,
  userId: string,
  { title, image_url, metadata, additional_media }: any,
  req: express.Request
): Promise<any> {
  const updateData: any = {
    updated_at: new Date().toISOString()
  };

  if (title !== undefined) updateData.title = title;
  if (image_url !== undefined) updateData.image_url = image_url;
  if (metadata !== undefined) updateData.metadata = metadata;

  // Обработка additional_media
  if (additional_media !== undefined) {
    let processedMedia = additional_media;

    if (Array.isArray(additional_media)) {
      processedMedia = additional_media.map((item: any) => {
        if (item && typeof item === 'object' && item.type === 'generated_video' && item.url) {
          const fileName = item.url.split('/').pop();
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          const instagramProxyUrl = `${baseUrl}/api/instagram-video-proxy/${fileName}`;
          return { ...item, instagram_proxy_url: instagramProxyUrl };
        }
        return item;
      });
      updateData.additional_media = JSON.stringify(processedMedia);
    } else if (typeof additional_media === 'string') {
      try {
        const parsed = JSON.parse(additional_media);
        if (Array.isArray(parsed)) {
          processedMedia = parsed.map((item: any) => {
            if (item && typeof item === 'object' && item.type === 'generated_video' && item.url) {
              const fileName = item.url.split('/').pop();
              const baseUrl = `${req.protocol}://${req.get('host')}`;
              const instagramProxyUrl = `${baseUrl}/api/instagram-video-proxy/${fileName}`;
              return { ...item, instagram_proxy_url: instagramProxyUrl };
            }
            return item;
          });
          updateData.additional_media = JSON.stringify(processedMedia);
        } else {
          updateData.additional_media = additional_media;
        }
      } catch (e) {
        updateData.additional_media = additional_media;
      }
    } else {
      updateData.additional_media = JSON.stringify(additional_media);
    }
  }

  // Автоматическая генерация изображения с текстом
  // ВАЖНО: НЕ генерируем изображение для видео! Только для изображений!
  if (metadata && !additional_media) {
    try {
      const parsedMeta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      const textOverlays = parsedMeta?.textOverlays || [];

      if (textOverlays.length > 0) {
        const storyResponse = await directusApi.get(`/items/campaign_content/${id}`, {
          headers: { 'Authorization': req.headers.authorization }
        });
        const currentStory = storyResponse.data.data;

        // ВАЖНО: Проверяем, что это НЕ видео!
        // Если есть video_url - это видео, не генерируем изображение
        if (!currentStory?.video_url) {
          const backgroundUrl = image_url || currentStory?.image_url;

          if (backgroundUrl && begetS3Storage) {
            const imageBuffer = await generateStoriesImageServer({
              backgroundUrl,
              textOverlays,
              width: 1080,
              height: 1920
            });

            const filename = `stories/story-generated-${Date.now()}.jpg`;
            const uploadResult = await begetS3Storage.uploadFile({
              key: filename,
              fileData: imageBuffer,
              contentType: 'image/jpeg'
            });

            if (uploadResult.success && uploadResult.url) {
              updateData.additional_media = JSON.stringify([{
                type: 'generated_image',
                url: uploadResult.url,
                generated_at: new Date().toISOString(),
                purpose: 'stories_publication'
              }]);
            }
          }
        } else {
          console.log('[STORIES-UPDATE] Обнаружено видео, пропускаем генерацию изображения');
        }
      }
    } catch (genError) {
      // Продолжаем без генерации
    }
  }

  const updateResponse = await directusApi.patch(`/items/campaign_content/${id}`, updateData, {
    headers: { 'Authorization': req.headers.authorization }
  });

  return updateResponse.data.data;
}

// Authentication check
router.use((req, res, next) => {
  next();
});

// Create a new story
router.post('/', authenticateUser, async (req, res) => {
  try {
    const { title, campaignId, content, type, status } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }


    // Create story content in campaign_content collection
    const storyData = {
      campaign_id: campaignId,
      user_id: userId,
      title: title || 'Новая история',
      content_type: type || 'story',
      status: status || 'draft',
      content: content || '', // Story content with positioning data
      metadata: JSON.stringify({
        storyType: 'instagram',
        format: '9:16',
        createdWith: 'enhanced_editor'
      }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const createResponse = await directusApi.post('/items/campaign_content', storyData, {
      headers: {
        'Authorization': req.headers.authorization
      }
    });
    const story = createResponse.data.data;

    res.json({ success: true, data: story });
  } catch (error) {
    console.error('Error creating story:', error);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

// Get all stories for user
router.get('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }


    const response = await directusApi.get('/items/campaign_content', {
      headers: {
        'Authorization': req.headers.authorization
      },
      params: {
        filter: JSON.stringify({
          user_id: { _eq: userId },
          content_type: { _in: ['story', 'video_story'] }
        }),
        sort: '-created_at'
      }
    });

    const stories = response.data.data || [];

    res.json({ success: true, data: stories });
  } catch (error) {
    console.error('Error fetching stories:', error);
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
});

// Update story - SPECIFIC ROUTE FOR STORIES ONLY
router.put('/story/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, slides } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }


    const updateData = {
      title: title || 'Новая история',
      metadata: JSON.stringify({
        slides: slides || [],
        storyType: 'instagram',
        format: '9:16',
        version: '1.0'
      }),
      updated_at: new Date().toISOString()
    };

    // Используем токен пользователя для обновления записи
    const updateResponse = await directusApi.patch(`/items/campaign_content/${id}`, updateData, {
      headers: {
        'Authorization': req.headers.authorization
      }
    });
    const story = updateResponse.data.data;

    res.json({ success: true, data: story });
  } catch (error) {
    console.error('Error updating story:', error);
    res.status(500).json({ error: 'Failed to update story' });
  }
});

// UPDATE SIMPLE STORY - NEW ENDPOINT FOR SIMPLE EDITOR (PUT и PATCH)
router.put('/simple/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("[STORY_PUBLISH] Request received for ID (PUT simple):", id);
    const { title, image_url, metadata, additional_media } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const story = await handleSimpleStoryUpdate(
      id,
      userId,
      { title, image_url, metadata, additional_media },
      req
    );

    res.json({ success: true, data: story });
  } catch (error) {
    console.error('Error updating simple story:', error);
    res.status(500).json({ error: 'Failed to update simple story' });
  }
});

// PATCH для частичного обновления
router.patch('/simple/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("[STORY_PUBLISH] Request received for ID (PATCH simple):", id);
    const { title, image_url, metadata, additional_media } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const story = await handleSimpleStoryUpdate(
      id,
      userId,
      { title, image_url, metadata, additional_media },
      req
    );

    res.json({ success: true, data: story });
  } catch (error) {
    console.error('Error patching simple story:', error);
    res.status(500).json({ error: 'Failed to patch simple story' });
  }
});

// Get story by ID - SPECIFIC ROUTE FOR STORIES ONLY
router.get('/story/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const response = await directusApi.get(`/items/campaign_content/${id}`, {
      headers: {
        'Authorization': req.headers.authorization
      }
    });
    const story = response.data.data;

    if (!story || story.user_id !== userId) {
      return res.status(404).json({ error: 'Story not found' });
    }

    res.json({ success: true, data: story });
  } catch (error) {
    console.error('Error fetching story:', error);
    res.status(500).json({ error: 'Не удалось загрузить историю' });
  }
});

// Delete story - SPECIFIC ROUTE FOR STORIES ONLY
router.delete('/story/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify ownership с пользовательским токеном
    const response = await directusApi.get(`/items/campaign_content/${id}`, {
      headers: {
        'Authorization': req.headers.authorization
      }
    });
    const story = response.data.data;
    if (!story || story.user_id !== userId) {
      return res.status(404).json({ error: 'Story not found' });
    }

    await directusApi.delete(`/items/campaign_content/${id}`, {
      headers: {
        'Authorization': req.headers.authorization
      }
    });

    res.json({ success: true, message: 'Story deleted successfully' });
  } catch (error) {
    console.error('Error deleting story:', error);
    res.status(500).json({ error: 'Failed to delete story' });
  }
});

// Publish story - SPECIFIC ROUTE FOR STORIES ONLY
router.post('/story/:id/publish', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("[STORY_PUBLISH] Request received for ID:", id);
    const { platforms, scheduledAt } = req.body;
    const userId = req.user?.id;


    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Ensure platforms is an array
    const publishPlatforms = platforms && Array.isArray(platforms) ? platforms : ['instagram'];

    if (!publishPlatforms || publishPlatforms.length === 0) {
      return res.status(400).json({ error: 'At least one platform is required' });
    }

    // Get story с пользовательским токеном
    const response = await directusApi.get(`/items/campaign_content/${id}`, {
      headers: {
        'Authorization': req.headers.authorization
      }
    });
    const story = response.data.data;
    if (!story || story.user_id !== userId) {
      return res.status(404).json({ error: 'Story not found' });
    }

    // Update story status and platforms
    // Формируем social_platforms как объект с pending статусами
    const socialPlatformsObj: Record<string, any> = {};
    for (const platform of publishPlatforms) {
      socialPlatformsObj[platform] = {
        status: scheduledAt ? 'scheduled' : 'pending',
        platform: platform
      };
      if (scheduledAt) {
        socialPlatformsObj[platform].scheduledAt = scheduledAt;
      }
    }

    const updateData = {
      status: scheduledAt ? 'scheduled' : 'pending',
      scheduled_time: scheduledAt || new Date().toISOString(),
      social_platforms: socialPlatformsObj,
      updated_at: new Date().toISOString()
    };

    const updateResponse = await directusApi.patch(`/items/campaign_content/${id}`, updateData, {
      headers: {
        'Authorization': req.headers.authorization
      }
    });
    const updatedStory = updateResponse.data.data;

    // Публикация Stories по платформам
    try {
      const userToken = req.headers.authorization?.replace('Bearer ', '');

      // Разделяем платформы
      const instagramPlatforms = publishPlatforms.filter((p: string) => p === 'instagram');
      const vkPlatforms = publishPlatforms.filter((p: string) => p === 'vk');
      const youtubePlatforms = publishPlatforms.filter((p: string) => p === 'youtube');
      const otherPlatforms = publishPlatforms.filter((p: string) => !['instagram', 'vk', 'youtube'].includes(p));

      const webhookPromises: Promise<any>[] = [];

      // VK Stories - прямая публикация через сервис
      if (vkPlatforms.length > 0) {

        webhookPromises.push(
          vkStoriesService.publishStory(updatedStory.id, userToken).then(result => {
            if (result.success) {
              return { type: 'vk', success: true, storyUrl: result.storyUrl };
            } else {
              return { type: 'vk', success: false, error: result.error };
            }
          }).catch(error => {
            return { type: 'vk', success: false, error: error.message };
          })
        );
      }

      // Instagram Stories через прямой API
      if (instagramPlatforms.length > 0) {
        let instagramImageUrl = updatedStory.image_url;

        // Генерируем картинку с текстом на сервере
        try {
          let textOverlays: any[] = [];
          if (updatedStory.metadata) {
            const meta = typeof updatedStory.metadata === 'string'
              ? JSON.parse(updatedStory.metadata)
              : updatedStory.metadata;
            textOverlays = meta.textOverlays || [];
          }

          let backgroundUrl = updatedStory.image_url;
          if (!backgroundUrl && updatedStory.additional_media) {
            const additionalMedia = typeof updatedStory.additional_media === 'string'
              ? JSON.parse(updatedStory.additional_media)
              : updatedStory.additional_media;
            if (Array.isArray(additionalMedia) && additionalMedia.length > 0) {
              backgroundUrl = additionalMedia[0].url || additionalMedia[0];
            }
          }

          if (textOverlays.length > 0 && backgroundUrl) {
            const imageBuffer = await generateStoriesImageServer({
              backgroundUrl: backgroundUrl,
              textOverlays: textOverlays,
              width: 1080,
              height: 1920
            });
            const uploadResult = await uploadToExternalHost(imageBuffer, `story-${updatedStory.id}.jpg`);
            instagramImageUrl = uploadResult.url;
          } else if (backgroundUrl) {
            try {
              const response = await axios.get(backgroundUrl, { responseType: 'arraybuffer' });
              const imageBuffer = Buffer.from(response.data);
              const uploadResult = await uploadToExternalHost(imageBuffer, `story-bg-${updatedStory.id}.jpg`);
              instagramImageUrl = uploadResult.url;
            } catch (uploadErr) {
            }
          }
        } catch (genError) {
          // Продолжаем с оригинальным изображением
        }

        // Если изображение изменилось — сохраняем в Directus перед публикацией
        if (instagramImageUrl && instagramImageUrl !== updatedStory.image_url) {
          try {
            await directus.request(updateItem('campaign_content', updatedStory.id, { image_url: instagramImageUrl }));
          } catch (updateErr) {
            // продолжаем с тем, что есть
          }
        }

        const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
        const { publishInstagramStory } = await import('../services/social-platforms/instagram-stories-service');

        webhookPromises.push(
          publishInstagramStory(updatedStory.id, adminToken)
            .then(result => ({ type: 'instagram', success: result.success, result }))
            .catch(err => ({ type: 'instagram', success: false, error: err.message }))
        );
      }

      // YouTube Shorts или Stories через единый n8n сервис (аналогично VK)
      if (youtubePlatforms.length > 0) {
        console.log('🚀 Добавляем YouTube в очередь публикации');
        webhookPromises.push(
          socialPublishingService.publishToPlatform(updatedStory, 'youtube', updatedStory, userToken)
            .then(result => ({
              type: 'youtube',
              success: result?.status === 'published',
              result
            }))
            .catch(error => ({
              type: 'youtube',
              success: false,
              error: error?.message || error
            }))
        );
      }

      // Остальные платформы — Stories пока не поддерживаются напрямую
      if (otherPlatforms.length > 0) {
        console.log(`[STORIES] Платформы ${otherPlatforms.join(', ')} не поддерживают Stories через прямой API`);
      }

      // Ждем все вызовы
      const results = await Promise.allSettled(webhookPromises);

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          const { type, success } = result.value;
          if (success) {
          } else {
          }
        } else {
        }
      });

    } catch (webhookError) {
    }

    res.json({
      success: true,
      data: updatedStory,
      message: scheduledAt ? 'Story scheduled for publication' : 'Story published successfully'
    });
  } catch (error) {
    console.error('Error publishing story:', error);
    res.status(500).json({ error: 'Failed to publish story' });
  }
});

// COMPLETE WORKFLOW: Convert video, save to Directus, publish to N8N
router.post('/convert-and-publish', authenticateUser, async (req, res) => {

  try {
    const {
      videoUrl,
      campaignId,
      title = 'Stories с конвертированным видео',
      platforms = ['instagram'],
      scheduledAt
    } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!videoUrl || !campaignId) {
      return res.status(400).json({
        error: 'videoUrl and campaignId are required'
      });
    }


    // STEP 1: Convert video using real video converter

    const conversionResult = await realVideoConverter.convertForInstagramStories(videoUrl);

    if (!conversionResult.success || !conversionResult.convertedUrl) {
      throw new Error(`Video conversion failed: ${conversionResult.error}`);
    }

    const convertedVideoUrl = conversionResult.convertedUrl;

    // STEP 2: Save story content to Directus with converted video URL

    const storyContent = {
      title: title,
      description: 'Автоматически конвертированное видео для Instagram Stories',
      videoUrl: convertedVideoUrl, // Use converted video URL
      mediaType: 'video',
      elements: []
    };

    // Формируем social_platforms как объект
    const socialPlatformsForVideo: Record<string, any> = {};
    const platformsList = Array.isArray(platforms) ? platforms : [platforms];
    for (const platform of platformsList) {
      socialPlatformsForVideo[platform] = {
        status: scheduledAt ? 'scheduled' : 'pending',
        platform: platform
      };
      if (scheduledAt) {
        socialPlatformsForVideo[platform].scheduledAt = scheduledAt;
      }
    }

    const storyData = {
      campaign_id: campaignId,
      user_id: userId,
      title: title,
      content_type: 'story',
      status: scheduledAt ? 'scheduled' : 'pending',
      content: storyContent,
      metadata: JSON.stringify({
        originalVideoUrl: videoUrl,
        convertedVideoUrl: convertedVideoUrl,
        conversionMetadata: conversionResult.metadata,
        storyType: 'instagram',
        format: '9:16',
        createdWith: 'real_video_converter'
      }),
      social_platforms: socialPlatformsForVideo,
      scheduled_time: scheduledAt || new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Try user token first, fallback to admin token
    let createResponse;
    try {
      createResponse = await directusApi.post('/items/campaign_content', storyData, {
        headers: {
          'Authorization': req.headers.authorization
        }
      });
    } catch (userError) {
      createResponse = await directusApi.post('/items/campaign_content', storyData, {
        headers: {
          'Authorization': `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}`
        }
      });
    }

    const savedStory = createResponse.data.data;

    // STEP 3: Publish to Instagram directly
    const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
    const { publishInstagramStory } = await import('../services/social-platforms/instagram-stories-service');
    const storyResult = await publishInstagramStory(savedStory.id, adminToken);

    // FINAL RESPONSE
    const result = {
      success: true,
      data: {
        storyId: savedStory.id,
        originalVideoUrl: videoUrl,
        convertedVideoUrl: convertedVideoUrl,
        conversionMetadata: conversionResult.metadata,
        publishSuccess: storyResult.success,
        publishError: storyResult.error || null
      },
      message: `Story converted, saved and ${storyResult.success ? 'published' : 'saved (publication failed)'} successfully`
    };

    res.json(result);

  } catch (error) {

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      success: false,
      error: `Complete workflow failed: ${errorMessage}`,
      step: 'conversion_or_saving_or_publishing'
    });
  }
});

// Export router with specific story routes only
router.post('/publish-video/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }


    // Get story content с fallback на admin токен
    let story;
    try {
      const response = await directusApi.get(`/items/campaign_content/${id}`, {
        headers: {
          'Authorization': req.headers.authorization
        }
      });
      story = response.data.data;
    } catch (userError) {
      const response = await directusApi.get(`/items/campaign_content/${id}`, {
        headers: {
          'Authorization': `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}`
        }
      });
      story = response.data.data;
    }

    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    // Проверяем владельца только если не админ
    if (story.user_id !== userId) {
      // Здесь можно добавить проверку админ статуса, пока разрешаем
    }

    if (!story.video_url) {
      return res.status(400).json({ error: 'Story has no video to convert' });
    }


    // Convert video for Instagram Stories using real FFmpeg converter
    const conversionResult = await realVideoConverter.convertForInstagramStories(story.video_url);

    if (!conversionResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to convert video for Instagram Stories',
        details: conversionResult.error
      });
    }


    // Update story with converted video URL
    const updateResult = await realVideoConverter.updateContentVideoUrl(
      id,
      conversionResult.convertedUrl!,
      req.headers.authorization as string
    );

    if (!updateResult) {
      return res.status(500).json({
        success: false,
        error: 'Video converted but failed to update database'
      });
    }

    // Publish to Instagram Stories via N8N webhook with creation_id fix
    const n8nPayload = {
      contentId: id,
      contentType: 'video_story',
      platforms: ['instagram'],
      scheduledAt: new Date().toISOString(),

      // КОНФИГУРАЦИЯ ДЛЯ СУЩЕСТВУЮЩЕГО WORKFLOW (который работал с другими видео)
      instagram_config: {
        media_type: 'VIDEO',
        published: false, // Двухэтапный процесс как в рабочем workflow
        api_version: 'v18.0',

        // ИСПРАВЛЕНИЕ: Instagram Stories может требовать image_url для видео
        container_parameters: {
          image_url: conversionResult.convertedUrl, // Instagram использует image_url даже для видео Stories
          media_type: 'VIDEO',
          published: false
        },

        // Параметры для публикации (Publish Story узел) 
        publish_parameters: {
          creation_id: '{{CONTAINER_ID}}' // Как в рабочем workflow
        },

        // Указываем что используем существующий Stories workflow
        use_existing_stories_workflow: true,
        workflow_type: 'instagram_stories'
      },

      content: {
        title: story.title || 'Video Story',
        description: story.content || '',
        videoUrl: conversionResult.convertedUrl,
        originalVideoUrl: story.video_url,
        mediaType: 'VIDEO',
        storyType: 'instagram_stories'
      },
      metadata: {
        converted: true,
        conversionTime: conversionResult.duration,
        videoFormat: 'mp4',
        resolution: '1080x1920',
        codec: 'H.264',
        ...conversionResult.metadata
      },
      campaignId: story.campaign_id,
      userId: story.user_id,
      // Instagram API specific fields (дублируем для совместимости)
      media_type: 'VIDEO',
      video_url: conversionResult.convertedUrl,
      image_url: conversionResult.convertedUrl, // Instagram Stories может использовать image_url для видео
      publish_mode: 'instagram_stories'
    };


    // Publish to Instagram directly
    const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
    const { publishInstagramStory } = await import('../services/social-platforms/instagram-stories-service');
    const storyResult = await publishInstagramStory(id, adminToken);

    if (storyResult.success) {
      return res.json({
        success: true,
        message: 'Video story converted and published successfully',
        data: {
          storyId: id,
          originalUrl: story.video_url,
          convertedUrl: conversionResult.convertedUrl,
          conversionTime: conversionResult.duration,
          metadata: conversionResult.metadata,
          postId: storyResult.postId,
          postUrl: storyResult.postUrl
        }
      });
    } else {
      return res.status(207).json({
        success: true,
        warning: 'Video converted successfully but publication failed',
        data: {
          storyId: id,
          originalUrl: story.video_url,
          convertedUrl: conversionResult.convertedUrl,
          conversionTime: conversionResult.duration,
          metadata: conversionResult.metadata
        },
        error: storyResult.error || 'Instagram publication failed'
      });
    }

  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Failed to publish video story',
      details: error.message
    });
  }
});

// Create new story for SimpleStoryEditor
router.post('/simple', authenticateUser, async (req, res) => {
  try {
    const { campaignId, title } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId is required' });
    }


    // Создаем базовую Stories с пустыми данными
    const storyData = {
      campaign_id: campaignId,
      user_id: userId,
      title: title || 'Новая Stories',
      content_type: 'story',
      status: 'draft',
      content: ' ', // Обязательное поле для Directus
      image_url: null, // Фоновое изображение - отдельное поле
      metadata: JSON.stringify({
        textOverlays: [{
          id: 'text1',
          text: 'Добавьте ваш текст',
          x: 100,
          y: 200,
          fontSize: 32,
          color: '#ffffff',
          fontFamily: 'Arial',
          fontWeight: 'bold',
          textAlign: 'center',
          backgroundColor: '#000000',
          padding: 10,
          borderRadius: 8
        }],
        additionalImages: [],
        storyType: 'instagram',
        format: '9:16',
        version: '1.0'
      }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const createResponse = await directusApi.post('/items/campaign_content', storyData, {
      headers: {
        'Authorization': req.headers.authorization
      }
    });

    const story = createResponse.data.data;

    res.json({ success: true, data: story });
  } catch (error: any) {
    console.error('Error creating story:', error?.response?.data || error?.message);

    if (error?.response?.status === 403) {
      res.status(403).json({ error: 'Access denied' });
    } else {
      res.status(500).json({ error: 'Failed to create story' });
    }
  }
});

// Update story with image_url and metadata - согласно ТЗ SimpleStoryEditor
// Get story by ID для SimpleStoryEditor
router.get('/simple/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }


    const response = await directusApi.get(`/items/campaign_content/${id}`, {
      headers: {
        'Authorization': req.headers.authorization
      }
    });
    const story = response.data.data;

    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    // Детальное логирование для диагностики проблемы разных изображений

    // Проверяем принадлежность пользователю
    if (story.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ success: true, data: story });
  } catch (error: any) {
    console.error('Error fetching story:', error?.response?.data || error?.message);

    if (error?.response?.status === 403) {
      res.status(403).json({ error: 'Access denied' });
    } else if (error?.response?.status === 404) {
      res.status(404).json({ error: 'Story not found' });
    } else {
      res.status(500).json({ error: 'Failed to fetch story' });
    }
  }
});

// Main publish endpoint for Stories - REFACTORED
router.post('/publish', authenticateUser, async (req, res) => {
  try {
    const { contentId, platforms, generatedImageUrl, generatedVideoUrl, useGeneratedImage, useGeneratedVideo } = req.body;
    console.log("[STORY_PUBLISH] Request received for contentId:", contentId);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!contentId || !platforms) {
      return res.status(400).json({ error: 'contentId and platforms are required' });
    }

    // Get story content
    const response = await directusApi.get(`/items/campaign_content/${contentId}`, {
      headers: { 'Authorization': req.headers.authorization }
    });
    const story = response.data.data;

    if (!story || story.user_id !== userId) {
      return res.status(404).json({ error: 'Story not found' });
    }

    if (story.content_type !== 'story') {
      return res.status(400).json({ error: 'Content is not a story type' });
    }

    // Update story status
    const selectedPlatformsList = Array.isArray(platforms) ? platforms : [platforms];
    const socialPlatformsUpdate: Record<string, any> = {};
    for (const platform of selectedPlatformsList) {
      socialPlatformsUpdate[platform] = {
        status: 'pending',
        platform: platform
      };
    }

    await directusApi.patch(`/items/campaign_content/${contentId}`, {
      status: 'scheduled',
      social_platforms: socialPlatformsUpdate
    }, {
      headers: { 'Authorization': req.headers.authorization }
    });

    // Determine media type using service
    const mediaType = StoriesMediaService.getMediaType(story);
    console.log('[STORIES-PUBLISH] Media type:', mediaType);

    // Process media if needed
    if (mediaType === 'video' && StoriesMediaService.needsMediaGeneration(story)) {
      console.log('[STORIES-PUBLISH] ✅ Генерация видео с текстом требуется');

      if (!generatedVideoUrl || useGeneratedVideo) {
        console.log('[STORIES-PUBLISH] ✅ Запускаем генерацию видео на сервере...');
        const textOverlays = StoriesMediaService.getTextOverlaysFromMetadata(story);

        const result = await StoriesMediaService.generateVideoWithText({
          videoUrl: story.video_url!,
          textOverlays,
          contentId,
          authToken: req.headers.authorization!,
        });

        if (!result.success) {
          console.warn('[STORIES-PUBLISH] ❌ Генерация видео не удалась, используем оригинал:', result.error);
        } else {
          console.log('[STORIES-PUBLISH] ✅ Видео успешно сгенерировано и сохранено в additional_media:', result.videoUrl);
        }
      } else if (generatedVideoUrl) {
        // Save client-provided video to additional_media
        await StoriesMediaService.saveToAdditionalMedia(
          contentId,
          generatedVideoUrl,
          'generated_video',
          req.headers.authorization!
        );
      }
    } else if (mediaType === 'image' && StoriesMediaService.needsMediaGeneration(story)) {
      console.log('[STORIES-PUBLISH] ✅ Генерация изображения с текстом требуется');

      // Если клиент уже прислал готовую картинку, можем использовать её или перегенерировать на сервере
      // Для надежности перегенерируем на сервере, если useGeneratedImage не выключен
      if (!generatedImageUrl || useGeneratedImage) {
        console.log('[STORIES-PUBLISH] ✅ Запускаем генерацию изображения на сервере...');
        const textOverlays = StoriesMediaService.getTextOverlaysFromMetadata(story);

        const result = await StoriesMediaService.generateImageWithText({
          mediaUrl: story.image_url!,
          textOverlays,
          contentId,
          authToken: req.headers.authorization!,
        });

        if (!result.success) {
          console.warn('[STORIES-PUBLISH] ❌ Генерация изображения не удалась:', result.error);
        } else {
          console.log('[STORIES-PUBLISH] ✅ Изображение успешно сгенерировано:', result.imageUrl);
        }
      } else if (generatedImageUrl) {
        // Если прислана готовая и мы решили её использовать
        await StoriesMediaService.saveToAdditionalMedia(
          contentId,
          generatedImageUrl,
          'generated_image',
          req.headers.authorization!
        );
      }
    } else if (mediaType === 'image' && generatedImageUrl && useGeneratedImage) {
      // Случай когда есть картинка от клиента, но в story.metadata текста может и не быть (простая загрузка)
      await StoriesMediaService.saveToAdditionalMedia(
        contentId,
        generatedImageUrl,
        'generated_image',
        req.headers.authorization!
      );
    }

    // Publish to platforms
    const webhookResults = [];
    const selectedPlatforms = Array.isArray(platforms) ? platforms : [platforms];
    const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
    console.log('[STORIES-PUBLISH] 🚀 Начинаем цикл публикации по платформам:', selectedPlatforms);

    for (const platform of selectedPlatforms) {
      console.log(`[STORIES-PUBLISH] 📦 Обработка платформы: ${platform}`);
      if (platform === 'instagram') {
        const { publishInstagramStory } = await import('../services/social-platforms/instagram-stories-service');
        try {
          const storyResult = await publishInstagramStory(contentId, adminToken);
          webhookResults.push({
            platform: 'instagram',
            success: storyResult.success,
            data: { postId: storyResult.postId, postUrl: storyResult.postUrl },
            error: storyResult.error
          });
        } catch (error: any) {
          webhookResults.push({
            platform: 'instagram',
            success: false,
            error: error.message
          });
        }
        continue;
      } else if (platform === 'vk') {

        try {
          const authToken = req.headers.authorization?.replace('Bearer ', '');
          // Передаем уже полученный объект story, чтобы не делать лишних запросов
          const vkResult = await vkStoriesService.publishStory(contentId, authToken, story);

          webhookResults.push({
            platform: 'vk',
            success: vkResult.success,
            data: vkResult
          });
        } catch (error) {
          webhookResults.push({
            platform: 'vk',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }


    const allSuccessful = webhookResults.every(result => result.success);
    const message = allSuccessful
      ? `Stories успешно опубликована на платформах: ${selectedPlatforms.join(', ')}`
      : `Stories частично опубликована. Проверьте детали.`;

    res.json({
      success: allSuccessful,
      message: message,
      results: webhookResults,
      generatedImageUsed: useGeneratedImage && generatedImageUrl
    });

  } catch (error) {
    console.error('[STORIES-PUBLISH] ❌ КРИТИЧЕСКАЯ ОШИБКА при публикации:', error);
    console.error('[STORIES-PUBLISH] ❌ Stack:', error instanceof Error ? error.stack : 'No stack');

    // ВАЖНО: Всегда возвращаем JSON, даже при ошибке!
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to publish stories',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    } else {
      console.error('[STORIES-PUBLISH] ❌ Headers already sent, cannot send error response');
    }
  }
});

/**
 * POST /api/stories/publish-clip
 * Публикация Клипов/Shorts (VK Clips, YouTube Shorts)
 */
router.post('/publish-clip', authenticateUser, async (req, res) => {
  try {
    const { contentId, platforms } = req.body;


    if (!contentId) {
      return res.status(400).json({ error: 'contentId is required' });
    }

    const authToken = req.headers.authorization?.replace('Bearer ', '');

    // Получаем контент для доступа к campaign_id и данным
    let content: any = null;
    let campaignSettings: any = null;

    try {
      const token = authToken || process.env.DIRECTUS_ADMIN_TOKEN;
      const contentResponse = await directusApi.get(`/items/campaign_content/${contentId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      content = contentResponse.data.data;

      if (content?.campaign_id) {
        const campaignResponse = await directusApi.get(`/items/user_campaigns/${content.campaign_id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const campaign = campaignResponse.data.data;
        // Проверяем все возможные места хранения настроек
        campaignSettings = campaign.social_media_settings
          || campaign.social_settings
          || campaign.campaign_settings
          || {};

      }
    } catch (err) {
    }

    // Определяем платформы для публикации
    let selectedPlatforms: string[] = [];
    if (platforms && typeof platforms === 'object' && !Array.isArray(platforms)) {
      // Если platforms - это объект {vk: true, youtube: false}, преобразуем в массив
      selectedPlatforms = Object.entries(platforms)
        .filter(([_, enabled]) => enabled)
        .map(([platform]) => platform);
    } else if (Array.isArray(platforms)) {
      selectedPlatforms = platforms;
    } else {
      selectedPlatforms = [platforms || 'vk'];
    }


    // Валидация: должна быть выбрана хотя бы одна платформа
    if (selectedPlatforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Не выбраны платформы для публикации',
        message: 'Пожалуйста, выберите хотя бы одну платформу (VK или YouTube)'
      });
    }

    const results: any[] = [];

    for (const platform of selectedPlatforms) {
      // VK Clips
      if (platform === 'vk') {

        try {
          const vkResult = await vkClipsService.publishClip(contentId, authToken);

          results.push({
            platform: 'vk',
            success: vkResult.success,
            data: vkResult
          });
        } catch (error) {
          results.push({
            platform: 'vk',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // YouTube Shorts
      if (platform === 'youtube') {

        try {
          if (!content) {
            throw new Error('Контент не найден');
          }

          if (!campaignSettings?.youtube) {
            throw new Error('YouTube настройки не найдены в кампании');
          }

          const youtubeService = new YouTubeService();

          // Подготавливаем контент для YouTube (помечаем как Shorts)
          const youtubeContent = {
            ...content,
            isShorts: true,
            metadata: {
              ...content.metadata,
              isShorts: true,
              videoFormat: 'shorts'
            }
          };

          const userId = req.user?.id || '';
          const ytResult = await youtubeService.publishContent(
            youtubeContent,
            campaignSettings,
            userId
          );

          results.push({
            platform: 'youtube',
            success: ytResult.success,
            data: {
              postUrl: ytResult.postUrl,
              quotaExceeded: ytResult.quotaExceeded
            },
            error: ytResult.error
          });

          // Обновляем social_platforms в контенте если успешно
          if (ytResult.success && ytResult.postUrl) {
            try {
              const token = authToken || process.env.DIRECTUS_ADMIN_TOKEN;
              const currentContent = await directusApi.get(`/items/campaign_content/${contentId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });

              const currentSocialPlatforms = currentContent.data.data.social_platforms || {};

              await directusApi.patch(`/items/campaign_content/${contentId}`, {
                status: 'published',
                published_at: new Date().toISOString(),
                social_platforms: {
                  ...currentSocialPlatforms,
                  youtube: {
                    status: 'published',
                    postUrl: ytResult.postUrl,
                    publishedAt: new Date().toISOString(),
                    type: 'shorts'
                  }
                }
              }, {
                headers: { 'Authorization': `Bearer ${token}` }
              });

            } catch (updateError) {
            }
          }

        } catch (error) {
          results.push({
            platform: 'youtube',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }


    const allSuccessful = results.length > 0 && results.every(r => r.success);
    const successfulPlatforms = results.filter(r => r.success).map(r => r.platform);

    res.json({
      success: allSuccessful,
      message: allSuccessful
        ? `Клип успешно опубликован на платформах: ${successfulPlatforms.join(', ')}`
        : results.length === 0
          ? 'Платформы для публикации не выбраны'
          : `Публикация завершена. Успешно: ${successfulPlatforms.join(', ') || 'нет'}`,
      results
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to publish clip',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/generate-image', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    const expectedApiKey = process.env.N8N_API_KEY || process.env.INTERNAL_API_KEY;

    if (!apiKey || apiKey !== expectedApiKey) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - invalid API key'
      });
    }

    const { backgroundUrl, textOverlays, contentId, metadata } = req.body;

    // Извлекаем textOverlays из разных источников
    let overlays = textOverlays;
    if (!overlays && metadata) {
      const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      overlays = meta.textOverlays;
    }

    console.log('[stories] Генерация изображения на сервере (n8n):', {
      backgroundUrl,
      textOverlaysCount: overlays?.length,
      contentId
    });

    if (!backgroundUrl) {
      return res.status(400).json({
        success: false,
        error: 'backgroundUrl обязателен'
      });
    }

    if (!begetS3Storage) {
      return res.status(500).json({
        success: false,
        error: 'S3 хранилище не инициализировано'
      });
    }

    const imageBuffer = await generateStoriesImageServer({
      backgroundUrl,
      textOverlays: overlays || [],
      width: 1080,
      height: 1920
    });

    console.log('[stories] Изображение сгенерировано, размер:', imageBuffer.length, 'байт');

    const filename = `stories-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;

    // Загружаем на Beget S3 (основное хранилище)
    const uploadResult = await begetS3Storage.uploadFile({
      key: `images/${filename}`,
      fileData: imageBuffer,
      contentType: 'image/jpeg'
    });

    if (!uploadResult.success || !uploadResult.url) {
      return res.status(500).json({
        success: false,
        error: 'Не удалось загрузить изображение в S3',
        details: uploadResult.error
      });
    }

    console.log('[stories] Изображение загружено в S3:', uploadResult.url);

    // Загружаем на внешний хостинг (ImgBB/Cloudinary) для Instagram
    let externalUrl: string | null = null;
    let externalHost: string | null = null;

    try {
      const externalUpload = await uploadToExternalHost(imageBuffer, filename);
      externalUrl = externalUpload.url;
      externalHost = externalUpload.host;
      console.log(`[stories] Изображение загружено на ${externalHost}:`, externalUrl);

      // Сохраняем URL в additional_media контента
      if (contentId && externalUrl) {
        try {
          const additionalMedia = [{
            type: 'instagram_ready_image',
            url: externalUrl,
            host: externalHost,
            generated_at: new Date().toISOString(),
            purpose: 'instagram_stories'
          }];

          await directusApi.patch(`/items/campaign_content/${contentId}`, {
            additional_media: JSON.stringify(additionalMedia),
            updated_at: new Date().toISOString()
          });

          console.log('[stories] URL сохранён в additional_media контента:', contentId);
        } catch (saveError: any) {
          console.warn('[stories] Не удалось сохранить URL в additional_media:', saveError?.message);
        }
      }
    } catch (externalError: any) {
      console.warn('[stories] Не удалось загрузить на внешний хостинг:', externalError?.message);
      // Продолжаем работу - S3 URL уже есть
    }

    res.json({
      success: true,
      imageUrl: uploadResult.url,
      externalImageUrl: externalUrl,
      externalHost: externalHost,
      contentId: contentId,
      dimensions: { width: 1080, height: 1920 },
      format: 'jpeg'
    });

  } catch (error) {
    console.error('[stories] Ошибка генерации изображения:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка генерации изображения',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;