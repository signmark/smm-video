/**
 * Прокси-сервер для видео Instagram
 * Обходит проблемы с заголовками S3 для Instagram Graph API
 */
import { Router, Request, Response } from 'express';
import { log } from '../utils/logger';
import sharp from 'sharp';
import { resolveSafeUrl } from '../utils/ssrf-guard';
import { safeFetch } from '../utils/safe-http';

const router = Router();

// Таймаут исходящих запросов к произвольным (не-Beget) URL, чтобы прокси не висел.
const OUTBOUND_FETCH_TIMEOUT_MS = 30_000;

/**
 * Преобразует изображение в формат 9:16 для Instagram Stories
 * Добавляет размытый фон для заполнения пустого пространства
 */
async function convertToStoryFormat(imageBuffer: Buffer): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  
  if (!metadata.width || !metadata.height) {
    throw new Error('Cannot read image dimensions');
  }

  const targetWidth = 1080;
  const targetHeight = 1920;
  const targetRatio = 9 / 16;
  const maxFileSize = 8 * 1024 * 1024; // 8MB max for Instagram

  const currentRatio = metadata.width / metadata.height;

  let resultBuffer: Buffer;

  // Если изображение уже примерно 9:16, просто ресайзим
  if (Math.abs(currentRatio - targetRatio) < 0.1) {
    resultBuffer = await sharp(imageBuffer)
      .rotate() // Автоматически исправляет ориентацию по EXIF
      .resize(targetWidth, targetHeight, { fit: 'cover' })
      .flatten({ background: { r: 255, g: 255, b: 255 } }) // Убираем прозрачность
      .toColourspace('srgb')
      .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer();
  } else {
    // Рассчитываем размер изображения чтобы оно вписалось в 9:16
    let resizedWidth: number;
    let resizedHeight: number;

    if (currentRatio > targetRatio) {
      // Изображение шире чем 9:16 - ограничиваем по ширине
      resizedWidth = targetWidth;
      resizedHeight = Math.round(targetWidth / currentRatio);
    } else {
      // Изображение выше чем 9:16 - ограничиваем по высоте
      resizedHeight = targetHeight;
      resizedWidth = Math.round(targetHeight * currentRatio);
    }

    // Ресайзим оригинальное изображение
    const resizedImage = await sharp(imageBuffer)
      .rotate()
      .resize(resizedWidth, resizedHeight)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toBuffer();

    // Создаём размытый фон из оригинального изображения
    const blurredBackground = await sharp(imageBuffer)
      .rotate()
      .resize(targetWidth, targetHeight, { fit: 'cover' })
      .blur(50)
      .modulate({ brightness: 0.7 })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toBuffer();

    // Накладываем чёткое изображение по центру размытого фона
    const left = Math.round((targetWidth - resizedWidth) / 2);
    const top = Math.round((targetHeight - resizedHeight) / 2);

    resultBuffer = await sharp(blurredBackground)
      .composite([{
        input: resizedImage,
        left,
        top
      }])
      .toColourspace('srgb')
      .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer();
  }

  // Если размер > 8MB, сжимаем с меньшим качеством
  let quality = 85;
  while (resultBuffer.length > maxFileSize && quality > 40) {
    quality -= 10;
    log(`[Story Converter] Размер ${resultBuffer.length} > 8MB, сжимаем до quality=${quality}`, 'media-proxy');
    resultBuffer = await sharp(resultBuffer)
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer();
  }

  return resultBuffer;
}

/**
 * GET /api/instagram-video-proxy/:videoId
 * Прокси для видео с правильными заголовками для Instagram
 */
router.get('/instagram-video-proxy/:videoId', async (req: Request, res: Response) => {
  try {
    const videoId = req.params.videoId;
    const rangeHeader = req.headers.range;
    
    log(`[Instagram Video Proxy] Запрос видео: ${videoId}`, 'instagram-proxy');
    log(`[Instagram Video Proxy] Range header: ${rangeHeader || 'отсутствует'}`, 'instagram-proxy');

    // Получаем оригинальный URL из S3
    const { begetS3StorageAws } = await import('../services/beget-s3-storage-aws');
    
    // Пытаемся найти файл в разных папках
    let s3Key = `videos/${videoId}`;
    let originalUrl = begetS3StorageAws.getPublicUrl(s3Key);
    let fileExists = await begetS3StorageAws.fileExists(s3Key);
    
    // Если не найден в videos/, пробуем test/
    if (!fileExists) {
      s3Key = `test/${videoId}`;
      originalUrl = begetS3StorageAws.getPublicUrl(s3Key);
      fileExists = await begetS3StorageAws.fileExists(s3Key);
    }
    
    // Если всё еще не найден, пробуем корень
    if (!fileExists) {
      s3Key = videoId;
      originalUrl = begetS3StorageAws.getPublicUrl(s3Key);
      fileExists = await begetS3StorageAws.fileExists(s3Key);
    }
    
    log(`[Instagram Video Proxy] Оригинальный S3 URL: ${originalUrl}`, 'instagram-proxy');

    // Проверяем существование файла в S3 (уже проверено выше)
    if (!fileExists) {
      log(`[Instagram Video Proxy] Файл не найден в S3: попробованы videos/, test/, и корень`, 'instagram-proxy');
      return res.status(404).json({
        error: 'Video file not found'
      });
    }
    
    log(`[Instagram Video Proxy] Файл найден в S3: ${s3Key}`, 'instagram-proxy');

    // Делаем запрос к S3
    const s3Response = await fetch(originalUrl, {
      headers: rangeHeader ? { 'Range': rangeHeader } : {}
    });

    if (!s3Response.ok) {
      log(`[Instagram Video Proxy] Ошибка S3 ответа: ${s3Response.status}`, 'instagram-proxy');
      return res.status(s3Response.status).json({
        error: 'Failed to fetch video from S3'
      });
    }

    // Получаем метаданные файла
    const contentLength = s3Response.headers.get('content-length');
    const contentType = s3Response.headers.get('content-type') || 'video/mp4';
    const contentRange = s3Response.headers.get('content-range');

    // Устанавливаем правильные заголовки для Instagram
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');  // КРИТИЧНО для Instagram
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Обрабатываем Range запросы (важно для Instagram)
    if (rangeHeader && contentRange) {
      res.status(206); // Partial Content
      res.setHeader('Content-Range', contentRange);
      log(`[Instagram Video Proxy] Partial content response: ${contentRange}`, 'instagram-proxy');
    } else if (rangeHeader && contentLength) {
      // Если S3 не поддерживает Range, эмулируем частичный контент
      const range = parseRangeHeader(rangeHeader, parseInt(contentLength));
      if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${contentLength}`);
        res.setHeader('Content-Length', (range.end - range.start + 1).toString());
        log(`[Instagram Video Proxy] Эмуляция partial content: ${range.start}-${range.end}`, 'instagram-proxy');
      }
    }

    // Передаем тело ответа
    if (s3Response.body) {
      const reader = s3Response.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(Buffer.from(value));
        return pump();
      };
      await pump();
    } else {
      res.end();
    }

    log(`[Instagram Video Proxy] Видео успешно передано через прокси`, 'instagram-proxy');

  } catch (error: any) {
    log(`[Instagram Video Proxy] Ошибка: ${error.message}`, 'instagram-proxy');
    res.status(500).json({
      error: 'Internal proxy error',
      details: error.message
    });
  }
});

/**
 * HEAD /api/instagram-video-proxy/:videoId
 * Возвращает метаданные видео с правильными заголовками
 */
router.head('/instagram-video-proxy/:videoId', async (req: Request, res: Response) => {
  try {
    const videoId = req.params.videoId;
    
    log(`[Instagram Video Proxy HEAD] Запрос метаданных: ${videoId}`, 'instagram-proxy');

    const { begetS3StorageAws } = await import('../services/beget-s3-storage-aws');
    const s3Key = `videos/${videoId}`;
    
    // Проверяем существование файла
    const fileExists = await begetS3StorageAws.fileExists(s3Key);
    if (!fileExists) {
      return res.status(404).end();
    }

    // Получаем размер файла (если возможно)
    const originalUrl = begetS3StorageAws.getPublicUrl(s3Key);
    const headResponse = await fetch(originalUrl, { method: 'HEAD' });

    if (!headResponse.ok) {
      return res.status(headResponse.status).end();
    }

    const contentLength = headResponse.headers.get('content-length');
    const contentType = headResponse.headers.get('content-type') || 'video/mp4';

    // Устанавливаем Instagram-совместимые заголовки
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    res.status(200).end();
    
    log(`[Instagram Video Proxy HEAD] Метаданные отправлены успешно`, 'instagram-proxy');

  } catch (error: any) {
    log(`[Instagram Video Proxy HEAD] Ошибка: ${error.message}`, 'instagram-proxy');
    res.status(500).end();
  }
});

/**
 * Парсит Range заголовок
 */
function parseRangeHeader(range: string, totalSize: number): { start: number; end: number } | null {
  const matches = range.match(/bytes=(\d+)-(\d*)/);
  if (!matches) return null;

  const start = parseInt(matches[1]);
  const end = matches[2] ? parseInt(matches[2]) : totalSize - 1;

  if (start >= totalSize || end >= totalSize || start > end) {
    return null;
  }

  return { start, end };
}

/**
 * GET /api/video-proxy/:encodedUrl.mp4
 * Path-based прокси для Facebook (требует прямой путь к файлу)
 * Использование: /api/video-proxy/<base64_encoded_url>.mp4
 * 
 * Использует AWS SDK для получения файлов из Beget S3 напрямую
 */
router.get('/video-proxy/:encodedUrl', async (req: Request, res: Response) => {
  try {
    let encodedUrl = req.params.encodedUrl;
    
    // Убираем .mp4 расширение если есть
    if (encodedUrl.endsWith('.mp4')) {
      encodedUrl = encodedUrl.slice(0, -4);
    }
    
    // Декодируем URL из base64
    const videoUrl = Buffer.from(encodedUrl, 'base64').toString('utf-8');
    const rangeHeader = req.headers.range;
    
    const videoUrlCheck = await resolveSafeUrl(videoUrl);
    if (!videoUrlCheck.ok) {
      log(`[Video Proxy] Отклонён URL (${videoUrlCheck.reason}): ${videoUrl}`, 'video-proxy');
      return res.status(400).json({
        error: 'Invalid or blocked URL'
      });
    }

    log(`[Video Proxy] Запрос видео: ${videoUrl}`, 'video-proxy');

    // Проверяем, является ли это Beget S3 URL
    const begetS3Pattern = /s3\.ru\d*\.storage\.beget\.cloud/;
    const isBegetS3 = begetS3Pattern.test(videoUrl);
    
    if (isBegetS3) {
      // Используем AWS SDK для получения файла из Beget S3
      log(`[Video Proxy] Обнаружен Beget S3 URL, используем AWS SDK`, 'video-proxy');
      
      const { begetS3StorageAws } = await import('../services/beget-s3-storage-aws');
      
      // Извлекаем ключ файла из URL
      // URL формат: https://<bucket>.s3.ru1.storage.beget.cloud/<key>
      const urlObj = new URL(videoUrl);
      const fileKey = urlObj.pathname.slice(1); // Убираем начальный /
      
      log(`[Video Proxy] Извлечен ключ файла: ${fileKey}`, 'video-proxy');
      
      // Получаем signed URL который работает без блокировки
      const signedUrl = await begetS3StorageAws.getSignedUrl(fileKey, 3600);
      
      if (!signedUrl) {
        log(`[Video Proxy] Не удалось получить signed URL для: ${fileKey}`, 'video-proxy');
        return res.status(404).json({
          error: 'File not found in S3'
        });
      }
      
      log(`[Video Proxy] Получен signed URL, делаем запрос`, 'video-proxy');
      
      // Делаем запрос с signed URL
      const sourceResponse = await fetch(signedUrl, {
        headers: rangeHeader ? { 'Range': rangeHeader } : {}
      });

      if (!sourceResponse.ok) {
        log(`[Video Proxy] Ошибка S3: ${sourceResponse.status}`, 'video-proxy');
        return res.status(sourceResponse.status).json({
          error: 'Failed to fetch video from S3'
        });
      }

      const contentLength = sourceResponse.headers.get('content-length');
      const contentType = 'video/mp4';
      const contentRange = sourceResponse.headers.get('content-range');

      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      if (rangeHeader && contentRange) {
        res.status(206);
        res.setHeader('Content-Range', contentRange);
      } else if (rangeHeader && contentLength) {
        const range = parseRangeHeader(rangeHeader, parseInt(contentLength));
        if (range) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${contentLength}`);
          res.setHeader('Content-Length', (range.end - range.start + 1).toString());
        }
      }

      if (sourceResponse.body) {
        const reader = sourceResponse.body.getReader();
        const pump = async () => {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          res.write(Buffer.from(value));
          return pump();
        };
        await pump();
      } else {
        res.end();
      }

      log(`[Video Proxy] Видео успешно передано через S3`, 'video-proxy');
      
    } else {
      // Для других URL используем обычный fetch с User-Agent
      log(`[Video Proxy] Обычный URL, используем fetch`, 'video-proxy');
      
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8'
      };
      if (rangeHeader) {
        headers['Range'] = rangeHeader;
      }

      const sourceResponse = await safeFetch(videoUrl, { headers, signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS) });

      if (!sourceResponse.ok) {
        log(`[Video Proxy] Ошибка источника: ${sourceResponse.status}`, 'video-proxy');
        return res.status(sourceResponse.status).json({
          error: 'Failed to fetch video'
        });
      }

      const contentLength = sourceResponse.headers.get('content-length');
      const contentType = 'video/mp4';
      const contentRange = sourceResponse.headers.get('content-range');

      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      if (rangeHeader && contentRange) {
        res.status(206);
        res.setHeader('Content-Range', contentRange);
      } else if (rangeHeader && contentLength) {
        const range = parseRangeHeader(rangeHeader, parseInt(contentLength));
        if (range) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${contentLength}`);
          res.setHeader('Content-Length', (range.end - range.start + 1).toString());
        }
      }

      if (sourceResponse.body) {
        const reader = sourceResponse.body.getReader();
        const pump = async () => {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          res.write(Buffer.from(value));
          return pump();
        };
        await pump();
      } else {
        res.end();
      }

      log(`[Video Proxy] Видео успешно передано`, 'video-proxy');
    }

  } catch (error: any) {
    log(`[Video Proxy] Ошибка: ${error.message}`, 'video-proxy');
    res.status(500).json({
      error: 'Internal proxy error',
      details: error.message
    });
  }
});

/**
 * GET /api/video-stream-proxy
 * Универсальный прокси для видео по URL (для Facebook и других платформ)
 * Использование: /api/video-stream-proxy?url=<encoded_video_url>
 */
router.get('/video-stream-proxy', async (req: Request, res: Response) => {
  try {
    const videoUrl = req.query.url as string;
    const rangeHeader = req.headers.range;
    
    if (!videoUrl) {
      return res.status(400).json({
        error: 'Missing url parameter'
      });
    }

    const streamUrlCheck = await resolveSafeUrl(videoUrl);
    if (!streamUrlCheck.ok) {
      log(`[Video Stream Proxy] Отклонён URL (${streamUrlCheck.reason}): ${videoUrl}`, 'video-proxy');
      return res.status(400).json({ error: 'Invalid or blocked URL' });
    }

    log(`[Video Stream Proxy] Запрос видео: ${videoUrl}`, 'video-proxy');
    log(`[Video Stream Proxy] Range header: ${rangeHeader || 'отсутствует'}`, 'video-proxy');

    // Делаем запрос к источнику
    const sourceResponse = await safeFetch(videoUrl, {
      headers: rangeHeader ? { 'Range': rangeHeader } : {},
      signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS)
    });

    if (!sourceResponse.ok) {
      log(`[Video Stream Proxy] Ошибка источника: ${sourceResponse.status}`, 'video-proxy');
      return res.status(sourceResponse.status).json({
        error: 'Failed to fetch video from source',
        status: sourceResponse.status
      });
    }

    // Получаем метаданные файла
    const contentLength = sourceResponse.headers.get('content-length');
    const contentType = sourceResponse.headers.get('content-type') || 'video/mp4';
    const contentRange = sourceResponse.headers.get('content-range');

    // Устанавливаем правильные заголовки
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Обрабатываем Range запросы
    if (rangeHeader && contentRange) {
      res.status(206);
      res.setHeader('Content-Range', contentRange);
      log(`[Video Stream Proxy] Partial content: ${contentRange}`, 'video-proxy');
    } else if (rangeHeader && contentLength) {
      const range = parseRangeHeader(rangeHeader, parseInt(contentLength));
      if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${contentLength}`);
        res.setHeader('Content-Length', (range.end - range.start + 1).toString());
      }
    }

    // Передаем тело ответа
    if (sourceResponse.body) {
      const reader = sourceResponse.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(Buffer.from(value));
        return pump();
      };
      await pump();
    } else {
      res.end();
    }

    log(`[Video Stream Proxy] Видео успешно передано`, 'video-proxy');

  } catch (error: any) {
    log(`[Video Stream Proxy] Ошибка: ${error.message}`, 'video-proxy');
    res.status(500).json({
      error: 'Internal proxy error',
      details: error.message
    });
  }
});

/**
 * GET /api/media-proxy/:encodedUrl
 * Универсальный прокси для медиа (изображения и видео) для Instagram/Facebook
 * Использование: /api/media-proxy/<base64_encoded_url>
 * Поддерживает: .jpg, .jpeg, .png, .gif, .webp, .mp4, .mov
 * Параметр ?story=1 преобразует изображение в формат 9:16 для Stories
 */
router.get('/media-proxy/:encodedUrl', async (req: Request, res: Response) => {
  try {
    let encodedUrl = req.params.encodedUrl;
    const convertToStory = req.query.story === '1';
    
    // Убираем расширение если есть
    const extensions = ['.mp4', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mov'];
    for (const ext of extensions) {
      if (encodedUrl.toLowerCase().endsWith(ext)) {
        encodedUrl = encodedUrl.slice(0, -ext.length);
        break;
      }
    }
    
    // Декодируем URL из base64
    const mediaUrl = Buffer.from(encodedUrl, 'base64').toString('utf-8');
    const rangeHeader = req.headers.range;
    
    const mediaUrlCheck = await resolveSafeUrl(mediaUrl);
    if (!mediaUrlCheck.ok) {
      log(`[Media Proxy] Отклонён URL (${mediaUrlCheck.reason}): ${mediaUrl}`, 'media-proxy');
      return res.status(400).json({
        error: 'Invalid or blocked URL'
      });
    }

    log(`[Media Proxy] Запрос медиа: ${mediaUrl}, story mode: ${convertToStory}`, 'media-proxy');

    // Определяем тип контента по URL
    const urlLower = mediaUrl.toLowerCase();
    let contentType = 'application/octet-stream';
    if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) {
      contentType = 'image/jpeg';
    } else if (urlLower.includes('.png')) {
      contentType = 'image/png';
    } else if (urlLower.includes('.gif')) {
      contentType = 'image/gif';
    } else if (urlLower.includes('.webp')) {
      contentType = 'image/webp';
    } else if (urlLower.includes('.mp4')) {
      contentType = 'video/mp4';
    } else if (urlLower.includes('.mov')) {
      contentType = 'video/quicktime';
    }

    // Проверяем, является ли это Beget S3 URL
    const begetS3Pattern = /s3\.ru\d*\.storage\.beget\.cloud/;
    const isBegetS3 = begetS3Pattern.test(mediaUrl);
    
    if (isBegetS3) {
      log(`[Media Proxy] Обнаружен Beget S3 URL, используем AWS SDK`, 'media-proxy');
      
      const { begetS3StorageAws } = await import('../services/beget-s3-storage-aws');
      
      // Извлекаем ключ файла из URL
      const urlObj = new URL(mediaUrl);
      const fileKey = urlObj.pathname.slice(1);
      
      log(`[Media Proxy] Извлечен ключ файла: ${fileKey}`, 'media-proxy');
      
      // Получаем signed URL
      const signedUrl = await begetS3StorageAws.getSignedUrl(fileKey, 3600);
      
      if (!signedUrl) {
        log(`[Media Proxy] Не удалось получить signed URL для: ${fileKey}`, 'media-proxy');
        return res.status(404).json({
          error: 'File not found in S3'
        });
      }
      
      // Делаем запрос с signed URL
      const sourceResponse = await fetch(signedUrl, {
        headers: rangeHeader ? { 'Range': rangeHeader } : {}
      });

      if (!sourceResponse.ok) {
        log(`[Media Proxy] Ошибка S3: ${sourceResponse.status}`, 'media-proxy');
        return res.status(sourceResponse.status).json({
          error: 'Failed to fetch media from S3'
        });
      }

      const s3ContentType = sourceResponse.headers.get('content-type');
      const isImage = s3ContentType?.startsWith('image/') || contentType.startsWith('image/');

      // Если нужно преобразование для Stories и это изображение
      if (convertToStory && isImage) {
        log(`[Media Proxy] Преобразуем изображение в формат 9:16 для Stories`, 'media-proxy');
        
        const arrayBuffer = await sourceResponse.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);
        
        try {
          const convertedImage = await convertToStoryFormat(imageBuffer);
          
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Content-Length', convertedImage.length.toString());
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.send(convertedImage);
          
          log(`[Media Proxy] Изображение успешно преобразовано для Stories (${convertedImage.length} bytes, JPEG)`, 'media-proxy');
          return;
        } catch (convError: any) {
          log(`[Media Proxy] Ошибка преобразования: ${convError.message}`, 'media-proxy');
          // Если преобразование не удалось, отдаём оригинал
        }
      }

      // Обычная передача без преобразования
      const contentLength = sourceResponse.headers.get('content-length');
      const contentRange = sourceResponse.headers.get('content-range');

      res.setHeader('Content-Type', s3ContentType || contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      if (rangeHeader && contentRange) {
        res.status(206);
        res.setHeader('Content-Range', contentRange);
      } else if (rangeHeader && contentLength) {
        const range = parseRangeHeader(rangeHeader, parseInt(contentLength));
        if (range) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${contentLength}`);
          res.setHeader('Content-Length', (range.end - range.start + 1).toString());
        }
      }

      if (sourceResponse.body) {
        const reader = sourceResponse.body.getReader();
        const pump = async () => {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          res.write(Buffer.from(value));
          return pump();
        };
        await pump();
      } else {
        res.end();
      }

      log(`[Media Proxy] Медиа успешно передано через S3`, 'media-proxy');
      
    } else {
      // Для других URL используем обычный fetch
      log(`[Media Proxy] Обычный URL, используем fetch`, 'media-proxy');
      
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*'
      };
      if (rangeHeader) {
        headers['Range'] = rangeHeader;
      }

      const sourceResponse = await safeFetch(mediaUrl, { headers, signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS) });

      if (!sourceResponse.ok) {
        log(`[Media Proxy] Ошибка источника: ${sourceResponse.status}`, 'media-proxy');
        return res.status(sourceResponse.status).json({
          error: 'Failed to fetch media'
        });
      }

      const srcContentType = sourceResponse.headers.get('content-type');
      const isImage = srcContentType?.startsWith('image/') || contentType.startsWith('image/');

      // Если нужно преобразование для Stories и это изображение
      if (convertToStory && isImage) {
        log(`[Media Proxy] Преобразуем изображение в формат 9:16 для Stories`, 'media-proxy');
        
        const arrayBuffer = await sourceResponse.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);
        
        try {
          const convertedImage = await convertToStoryFormat(imageBuffer);
          
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Content-Length', convertedImage.length.toString());
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.send(convertedImage);
          
          log(`[Media Proxy] Изображение успешно преобразовано для Stories (${convertedImage.length} bytes, JPEG)`, 'media-proxy');
          return;
        } catch (convError: any) {
          log(`[Media Proxy] Ошибка преобразования: ${convError.message}`, 'media-proxy');
        }
      }

      const contentLength = sourceResponse.headers.get('content-length');
      const contentRange = sourceResponse.headers.get('content-range');

      res.setHeader('Content-Type', srcContentType || contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      if (rangeHeader && contentRange) {
        res.status(206);
        res.setHeader('Content-Range', contentRange);
      } else if (rangeHeader && contentLength) {
        const range = parseRangeHeader(rangeHeader, parseInt(contentLength));
        if (range) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${contentLength}`);
          res.setHeader('Content-Length', (range.end - range.start + 1).toString());
        }
      }

      if (sourceResponse.body) {
        const reader = sourceResponse.body.getReader();
        const pump = async () => {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          res.write(Buffer.from(value));
          return pump();
        };
        await pump();
      } else {
        res.end();
      }

      log(`[Media Proxy] Медиа успешно передано`, 'media-proxy');
    }

  } catch (error: any) {
    log(`[Media Proxy] Ошибка: ${error.message}`, 'media-proxy');
    res.status(500).json({
      error: 'Internal proxy error',
      details: error.message
    });
  }
});

/**
 * HEAD /api/video-stream-proxy
 * Метаданные видео
 */
router.head('/video-stream-proxy', async (req: Request, res: Response) => {
  try {
    const videoUrl = req.query.url as string;
    
    if (!videoUrl) {
      return res.status(400).end();
    }

    if (!(await resolveSafeUrl(videoUrl)).ok) {
      log(`[Video Stream Proxy HEAD] Отклонён URL: ${videoUrl}`, 'video-proxy');
      return res.status(400).end();
    }

    log(`[Video Stream Proxy HEAD] Запрос метаданных: ${videoUrl}`, 'video-proxy');

    const headResponse = await safeFetch(videoUrl, { method: 'HEAD', signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS) });

    if (!headResponse.ok) {
      return res.status(headResponse.status).end();
    }

    const contentLength = headResponse.headers.get('content-length');
    const contentType = headResponse.headers.get('content-type') || 'video/mp4';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    res.status(200).end();
    
    log(`[Video Stream Proxy HEAD] Метаданные отправлены`, 'video-proxy');

  } catch (error: any) {
    log(`[Video Stream Proxy HEAD] Ошибка: ${error.message}`, 'video-proxy');
    res.status(500).end();
  }
});

export default router;