/**
 * Clips/Shorts Publishing Router
 * 
 * Прямая публикация коротких видео (VK Clips, YouTube Shorts, Instagram Reels) без N8N
 * Этот функционал позже будет перенесён в N8N
 */

import express from 'express';
import { log } from '../utils/logger';
import { authMiddleware } from '../middleware/auth';
import { socialPublishingService } from '../services/social/index';
import { vkClipsService } from '../services/social-platforms/vk-clips-service';
import { instagramReelsService } from '../services/social-platforms/instagram-reels-service';
import { youtubeShortsService } from '../services/social-platforms/youtube-shorts-service';
import { publicationLockManager } from '../services/publication-lock-manager';
import axios from 'axios';

const router = express.Router();

const LOG_PREFIX = 'clips-publishing';
const activeLocks = new Set<string>();

interface PublishResult {
  platform: string;
  success: boolean;
  postUrl?: string;
  error?: string;
}

/**
 * POST /api/clips/publish
 * Публикация clips/shorts напрямую (без N8N)
 */
router.post('/clips/publish', authMiddleware, async (req, res) => {
  try {
    const { contentId, platforms } = req.body;
    
    log(`Запрос публикации clips для контента ${contentId}`, LOG_PREFIX);
    log(`Платформы: ${JSON.stringify(platforms)}`, LOG_PREFIX);
    
    if (!contentId) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId'
      });
    }
    
    const userToken = req.headers.authorization?.replace('Bearer ', '');
    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'Отсутствует токен авторизации'
      });
    }
    
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    
    const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    
    const content = contentResponse.data.data;
    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Контент не найден'
      });
    }
    
    log(`Контент получен: type=${content.content_type}, video_url=${!!content.video_url}`, LOG_PREFIX);
    
    const campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${content.campaign_id}`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    
    const campaign = campaignResponse.data.data;
    const campaignSettings = campaign?.social_media_settings || {};
    
    let selectedPlatforms: string[] = [];
    if (Array.isArray(platforms)) {
      selectedPlatforms = platforms;
    } else if (typeof platforms === 'object' && platforms !== null) {
      selectedPlatforms = Object.entries(platforms)
        .filter(([_, enabled]) => enabled)
        .map(([platform]) => platform);
    }
    
    log(`Parsed selectedPlatforms: ${JSON.stringify(selectedPlatforms)} (from input: ${JSON.stringify(platforms)})`, LOG_PREFIX);
    
    if (selectedPlatforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо выбрать хотя бы одну платформу для публикации'
      });
    }
    
    log(`Публикация в платформы: ${selectedPlatforms.join(', ')}`, LOG_PREFIX);
    
    const results: PublishResult[] = [];
    const userId = (req as any).user?.id || 'unknown';
    
    for (const platform of selectedPlatforms) {
      const lockAcquired = await publicationLockManager.acquireLock(contentId, platform);
      
      if (!lockAcquired) {
        log(`Публикация ${platform} для ${contentId} уже в процессе (lock)`, LOG_PREFIX);
        results.push({
          platform,
          success: false,
          error: 'Публикация уже в процессе'
        });
        continue;
      }
      
      try {
        if (platform === 'vk') {
          log(`Публикация VK Clip (прямая) для контента ${contentId}`, LOG_PREFIX);
          const result = await vkClipsService.publishClip(contentId, userToken);
          results.push({ platform, success: result.success, postUrl: result.videoUrl, error: result.error });
          await updatePlatformStatus(directusUrl, userToken, contentId, 'vk',
            result.success ? 'published' : 'failed', result.videoUrl, result.error);

        } else if (platform === 'instagram') {
          log(`Публикация Instagram Reels (прямая) для контента ${contentId}`, LOG_PREFIX);
          const result = await instagramReelsService.publishReels(contentId, userToken);
          results.push({ platform, success: result.success, postUrl: result.postUrl, error: result.error });
          await updatePlatformStatus(directusUrl, userToken, contentId, 'instagram',
            result.success ? 'published' : 'failed', result.postUrl, result.error);

        } else if (platform === 'youtube') {
          log(`Публикация YouTube Shorts (прямая) для контента ${contentId}`, LOG_PREFIX);
          const result = await youtubeShortsService.publishShort(contentId, userToken);
          results.push({ platform, success: result.success, postUrl: result.videoUrl, error: result.error });
          await updatePlatformStatus(directusUrl, userToken, contentId, 'youtube',
            result.success ? 'published' : 'failed', result.videoUrl, result.error);

        } else {
          log(`Публикация в ${platform} через общий сервис для контента ${contentId}`, LOG_PREFIX);
          const result = await socialPublishingService.publishToPlatform(
            content, platform, campaign, userToken
          );
          results.push({
            platform,
            success: result.status === 'published',
            postUrl: result.postUrl || result.url,
            error: result.error
          });
          log(`${platform} результат: status=${result.status}, url=${result.postUrl || result.url}`, LOG_PREFIX);
        }
      } catch (platformError: any) {
        log(`Ошибка публикации в ${platform}: ${platformError.message}`, LOG_PREFIX);
        results.push({
          platform,
          success: false,
          error: platformError.message
        });
      } finally {
        await publicationLockManager.releaseLock(contentId, platform);
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const allSuccess = successCount === results.length;
    
    if (allSuccess) {
      await updateContentStatus(directusUrl, userToken, contentId, 'published');
    } else if (successCount > 0) {
      await updateContentStatus(directusUrl, userToken, contentId, 'partially_published');
    }
    
    log(`Результаты публикации: ${successCount}/${results.length} успешно`, LOG_PREFIX);
    
    return res.json({
      success: successCount > 0,
      message: allSuccess 
        ? 'Контент успешно опубликован во все платформы' 
        : successCount > 0 
          ? `Частично опубликовано: ${successCount}/${results.length}` 
          : 'Ошибка публикации',
      results
    });
    
  } catch (error: any) {
    log(`Ошибка публикации clips: ${error.message}`, LOG_PREFIX);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/clips/publish/:platform
 * Публикация в конкретную платформу
 */
router.post('/clips/publish/:platform', authMiddleware, async (req, res) => {
  try {
    const { platform } = req.params;
    const { contentId } = req.body;
    
    log(`Публикация в ${platform} для контента ${contentId}`, LOG_PREFIX);
    
    if (!contentId) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId'
      });
    }
    
    const userToken = req.headers.authorization?.replace('Bearer ', '');
    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'Отсутствует токен авторизации'
      });
    }
    
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    
    const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    
    const content = contentResponse.data.data;
    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Контент не найден'
      });
    }
    
    const campaignResponse = await axios.get(`${directusUrl}/items/user_campaigns/${content.campaign_id}`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    
    const campaign = campaignResponse.data.data;
    const campaignSettings = campaign?.social_media_settings || {};
    const userId = (req as any).user?.id || 'unknown';
    
    let result: PublishResult;
    
    if (platform === 'vk') {
      log(`Публикация VK Clip (прямая) для контента ${contentId}`, LOG_PREFIX);
      const publishResult = await vkClipsService.publishClip(contentId, userToken);
      result = { platform: 'vk', success: publishResult.success, postUrl: publishResult.videoUrl, error: publishResult.error };
      if (publishResult.success) {
        await updatePlatformStatus(directusUrl, userToken, contentId, 'vk', 'published', publishResult.videoUrl);
      }

    } else if (platform === 'instagram') {
      log(`Публикация Instagram Reels (прямая) для контента ${contentId}`, LOG_PREFIX);
      const publishResult = await instagramReelsService.publishReels(contentId, userToken);
      result = { platform: 'instagram', success: publishResult.success, postUrl: publishResult.postUrl, error: publishResult.error };
      if (publishResult.success) {
        await updatePlatformStatus(directusUrl, userToken, contentId, 'instagram', 'published', publishResult.postUrl);
      }

    } else if (platform === 'youtube') {
      log(`Публикация YouTube Shorts (прямая) для контента ${contentId}`, LOG_PREFIX);
      const publishResult = await youtubeShortsService.publishShort(contentId, userToken);
      result = { platform: 'youtube', success: publishResult.success, postUrl: publishResult.videoUrl, error: publishResult.error };
      if (publishResult.success) {
        await updatePlatformStatus(directusUrl, userToken, contentId, 'youtube', 'published', publishResult.videoUrl);
      }

    } else {
      log(`Публикация в ${platform} через общий сервис для контента ${contentId}`, LOG_PREFIX);
      const publishResult = await socialPublishingService.publishToPlatform(
        content, platform, campaign, userToken
      );
      result = {
        platform,
        success: publishResult.status === 'published',
        postUrl: publishResult.postUrl || publishResult.url,
        error: publishResult.error
      };
    }
    
    return res.json({
      success: result.success,
      message: result.success ? `Опубликовано в ${platform}` : `Ошибка: ${result.error}`,
      result
    });
    
  } catch (error: any) {
    log(`Ошибка публикации в ${req.params.platform}: ${error.message}`, LOG_PREFIX);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

async function updatePlatformStatus(
  directusUrl: string,
  token: string,
  contentId: string,
  platform: string,
  status: string,
  postUrl?: string,
  error?: string
) {
  try {
    const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const content = contentResponse.data.data;
    const socialPlatforms = content.social_platforms || {};
    
    socialPlatforms[platform] = {
      ...socialPlatforms[platform],
      status,
      postUrl,
      error,
      publishedAt: status === 'published' ? new Date().toISOString() : undefined
    };
    
    await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
      social_platforms: socialPlatforms
    }, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    log(`Статус ${platform} обновлен на ${status}`, LOG_PREFIX);
  } catch (error: any) {
    log(`Ошибка обновления статуса ${platform}: ${error.message}`, LOG_PREFIX);
  }
}

async function updateContentStatus(
  directusUrl: string,
  token: string,
  contentId: string,
  status: string
) {
  try {
    await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
      status
    }, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    log(`Статус контента ${contentId} обновлен на ${status}`, LOG_PREFIX);
  } catch (error: any) {
    log(`Ошибка обновления статуса контента: ${error.message}`, LOG_PREFIX);
  }
}

export default router;
