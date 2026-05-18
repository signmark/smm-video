/**
 * Тестовые маршруты для диагностики Instagram видео
 */
import { Router } from 'express';
import { validateInstagramVideoUrl, generateVideoReport } from '../utils/instagram-video-validator';
import { log } from '../utils/logger';

const router = Router();

/**
 * POST /api/test/instagram-video
 * Проверяет URL видео на совместимость с Instagram Graph API
 */
router.post('/instagram-video', async (req, res) => {
  try {
    const { videoUrl } = req.body;
    
    if (!videoUrl) {
      return res.status(400).json({
        success: false,
        error: 'videoUrl обязателен для проверки'
      });
    }

    log(`[Instagram Video Test] Тестирование URL: ${videoUrl}`, 'instagram-test');

    // Выполняем валидацию
    const validation = await validateInstagramVideoUrl(videoUrl);
    const report = generateVideoReport(validation, videoUrl);

    // Логируем результат
    log(`[Instagram Video Test] Результат проверки:`, 'instagram-test');
    log(report, 'instagram-test');

    return res.json({
      success: true,
      data: {
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings,
        details: validation.details,
        report: report
      }
    });

  } catch (error: any) {
    log(`[Instagram Video Test] Ошибка при тестировании: ${error.message}`, 'instagram-test');
    return res.status(500).json({
      success: false,
      error: `Ошибка при тестировании видео: ${error.message}`
    });
  }
});

/**
 * POST /api/test/instagram-upload-and-test
 * Загружает тестовое видео и проверяет его на совместимость
 */
router.post('/instagram-upload-and-test', async (req, res) => {
  try {
    const { videoPath } = req.body;
    
    if (!videoPath) {
      return res.status(400).json({
        success: false,
        error: 'videoPath обязателен для загрузки и тестирования'
      });
    }

    log(`[Instagram Upload Test] Загрузка и тестирование: ${videoPath}`, 'instagram-test');

    // Загружаем видео в S3
    const { begetS3StorageAws } = await import('../services/beget-s3-storage-aws');
    
    const uploadResult = await begetS3StorageAws.uploadFile({
      filePath: videoPath,
      contentType: 'video/mp4',
      key: `test/instagram_test_${Date.now()}.mp4`
    });

    if (!uploadResult.success || !uploadResult.url) {
      return res.status(500).json({
        success: false,
        error: `Ошибка загрузки в S3: ${uploadResult.error}`
      });
    }

    log(`[Instagram Upload Test] Видео загружено: ${uploadResult.url}`, 'instagram-test');

    // Проверяем загруженное видео
    const validation = await validateInstagramVideoUrl(uploadResult.url);
    const report = generateVideoReport(validation, uploadResult.url);

    log(`[Instagram Upload Test] Результат проверки загруженного видео:`, 'instagram-test');
    log(report, 'instagram-test');

    return res.json({
      success: true,
      data: {
        uploadUrl: uploadResult.url,
        uploadKey: uploadResult.key,
        validation: {
          isValid: validation.isValid,
          errors: validation.errors,
          warnings: validation.warnings,
          details: validation.details
        },
        report: report
      }
    });

  } catch (error: any) {
    log(`[Instagram Upload Test] Ошибка: ${error.message}`, 'instagram-test');
    return res.status(500).json({
      success: false,
      error: `Ошибка при загрузке и тестировании: ${error.message}`
    });
  }
});

/**
 * GET /api/test/instagram-s3-headers/:key
 * Проверяет заголовки конкретного файла в S3
 */
router.get('/instagram-s3-headers/:key(*)', async (req, res) => {
  try {
    const fileKey = req.params.key;
    
    if (!fileKey) {
      return res.status(400).json({
        success: false,
        error: 'Ключ файла обязателен'
      });
    }

    log(`[Instagram S3 Test] Проверка заголовков для: ${fileKey}`, 'instagram-test');

    // Получаем публичный URL
    const { begetS3StorageAws } = await import('../services/beget-s3-storage-aws');
    const publicUrl = begetS3StorageAws.getPublicUrl(fileKey);

    // Проверяем заголовки
    const validation = await validateInstagramVideoUrl(publicUrl);
    const report = generateVideoReport(validation, publicUrl);

    log(`[Instagram S3 Test] Результат проверки заголовков:`, 'instagram-test');
    log(report, 'instagram-test');

    return res.json({
      success: true,
      data: {
        fileKey: fileKey,
        publicUrl: publicUrl,
        validation: {
          isValid: validation.isValid,
          errors: validation.errors,
          warnings: validation.warnings,
          details: validation.details
        },
        report: report
      }
    });

  } catch (error: any) {
    log(`[Instagram S3 Test] Ошибка при проверке заголовков: ${error.message}`, 'instagram-test');
    return res.status(500).json({
      success: false,
      error: `Ошибка при проверке заголовков: ${error.message}`
    });
  }
});

export default router;