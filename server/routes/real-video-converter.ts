import { Router } from 'express';
import { realVideoConverter } from '../services/real-video-converter';
import { directusApi } from '../directus';

const router = Router();

/**
 * POST /api/real-video-converter/convert
 * Конвертирует видео для Instagram Stories
 */
router.post('/convert', async (req, res) => {
  try {
    const { videoUrl, localPath, forceConvert } = req.body;

    if (!videoUrl && !localPath) {
      return res.status(400).json({
        success: false,
        error: 'Video URL or local path is required'
      });
    }

    const sourceUrl = videoUrl || localPath;
    console.log('[real-video-converter-api] Starting conversion:', sourceUrl, forceConvert ? '(FORCED)' : '');

    // Для локальных файлов всегда выполняем конвертацию
    if (localPath || !realVideoConverter.needsConversion(sourceUrl, forceConvert)) {
      if (!localPath) {
        return res.json({
          success: true,
          convertedUrl: videoUrl,
          originalUrl: videoUrl,
          method: 'no_conversion_needed',
          message: 'Video already converted for Instagram Stories'
        });
      }
    }

    // Выполняем реальную конвертацию
    const result = localPath 
      ? await realVideoConverter.convertLocalFile(localPath, forceConvert)
      : await realVideoConverter.convertForInstagramStories(videoUrl, forceConvert);

    if (result.success) {
      console.log('[real-video-converter-api] Conversion successful:', result.convertedUrl);
      
      // ОБНОВЛЯЕМ КОНТЕНТ С НОВЫМ URL ВИДЕО
      if (forceConvert && req.body.contentId) {
        try {
          console.log('[real-video-converter-api] Updating content with new video URL:', req.body.contentId);
          
          // Обновляем через системный токен
          const adminToken = process.env.DIRECTUS_ADMIN_TOKEN;
          await directusApi.patch(`/items/campaign_content/${req.body.contentId}`, {
            video_url: result.convertedUrl,
            updated_at: new Date().toISOString()
          }, {
            headers: {
              'Authorization': `Bearer ${adminToken}`
            }
          });
          
          console.log('[real-video-converter-api] Content updated with new video URL');
        } catch (updateError) {
          console.error('[real-video-converter-api] Failed to update content:', updateError);
        }
      }
      
      return res.json({
        success: true,
        convertedUrl: result.convertedUrl,
        originalUrl: result.originalUrl,
        duration: result.duration,
        metadata: result.metadata,
        method: 'ffmpeg_conversion',
        message: 'Video successfully converted for Instagram Stories',
        contentUpdated: !!(forceConvert && req.body.contentId)
      });
    } else {
      console.error('[real-video-converter-api] Conversion failed:', result.error);
      
      return res.status(500).json({
        success: false,
        error: result.error,
        originalUrl: result.originalUrl,
        message: 'Video conversion failed'
      });
    }

  } catch (error: any) {
    console.error('[real-video-converter-api] API error:', error.message);
    
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Internal server error during video conversion'
    });
  }
});

/**
 * POST /api/real-video-converter/force-convert
 * Принудительная конвертация видео (игнорирует все проверки)
 */
router.post('/force-convert', async (req, res) => {
  try {
    const { videoUrl } = req.body;

    if (!videoUrl) {
      return res.status(400).json({
        success: false,
        error: 'Video URL is required'
      });
    }

    console.log('[real-video-converter-api] FORCE CONVERT:', videoUrl);

    // ПРИНУДИТЕЛЬНАЯ конвертация - игнорируем все проверки
    const result = await realVideoConverter.convertForInstagramStories(videoUrl, true);

    if (result.success) {
      console.log('[real-video-converter-api] Force conversion successful:', result.convertedUrl);
      
      return res.json({
        success: true,
        convertedUrl: result.convertedUrl,
        originalUrl: result.originalUrl,
        duration: result.duration,
        metadata: result.metadata,
        method: 'ffmpeg_force_conversion',
        message: 'Video forcefully converted for Instagram Stories'
      });
    } else {
      console.error('[real-video-converter-api] Force conversion failed:', result.error);
      
      return res.status(500).json({
        success: false,
        error: result.error,
        originalUrl: result.originalUrl,
        message: 'Forced video conversion failed'
      });
    }

  } catch (error: any) {
    console.error('[real-video-converter-api] Force convert API error:', error.message);
    
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Internal server error during forced video conversion'
    });
  }
});

/**
 * GET /api/real-video-converter/status
 * Проверка доступности FFmpeg
 */
router.get('/status', async (req, res) => {
  try {
    const ffmpegAvailable = await realVideoConverter.checkFFmpegAvailable();
    
    res.json({
      success: true,
      ffmpegAvailable,
      message: ffmpegAvailable ? 'FFmpeg is available for video conversion' : 'FFmpeg not found on system',
      version: ffmpegAvailable ? 'Available' : 'Not installed'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      ffmpegAvailable: false,
      message: 'Error checking FFmpeg status'
    });
  }
});

/**
 * POST /api/real-video-converter/convert-content
 * Конвертирует видео для конкретного контента и обновляет базу данных
 */
router.post('/convert-content', async (req, res) => {
  try {
    const { contentId } = req.body;

    if (!contentId) {
      return res.status(400).json({
        success: false,
        error: 'Content ID is required'
      });
    }

    // Получаем контент из Directus
    const { directusApi } = await import('../directus');
    
    let content;
    try {
      const response = await directusApi.get(`/items/campaign_content/${contentId}`, {
        headers: req.headers.authorization ? { 'Authorization': req.headers.authorization } : undefined
      });
      content = response.data.data;
    } catch (userError) {
      const response = await directusApi.get(`/items/campaign_content/${contentId}`, {
        headers: {
          'Authorization': `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}`
        }
      });
      content = response.data.data;
    }

    if (!content?.video_url) {
      return res.status(404).json({
        success: false,
        error: 'Content not found or has no video URL'
      });
    }

    console.log('[real-video-converter-api] Converting video for content:', contentId);
    
    // Конвертируем видео
    const result = await realVideoConverter.convertForInstagramStories(content.video_url);

    if (result.success && result.convertedUrl) {
      // Обновляем URL в базе данных
      const updated = await realVideoConverter.updateContentVideoUrl(
        contentId, 
        result.convertedUrl,
        req.headers.authorization as string
      );

      if (updated) {
        console.log('[real-video-converter-api] Content video URL updated in database');

        return res.json({
          success: true,
          contentId,
          originalUrl: content.video_url,
          convertedUrl: result.convertedUrl,
          duration: result.duration,
          metadata: result.metadata,
          message: 'Video converted and database updated successfully'
        });
      } else {
        return res.status(500).json({
          success: false,
          error: 'Video converted but failed to update database',
          convertedUrl: result.convertedUrl,
          originalUrl: content.video_url
        });
      }
    } else {
      return res.status(500).json({
        success: false,
        error: result.error || 'Video conversion failed',
        originalUrl: content.video_url,
        contentId
      });
    }

  } catch (error: any) {
    console.error('[real-video-converter-api] Convert content error:', error.message);
    
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Internal server error during content video conversion'
    });
  }
});

export default router;