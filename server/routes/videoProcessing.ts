import express from 'express';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { authMiddleware } from '../middleware/auth';

/**
 * Получает путь к шрифту, поддерживающему кириллицу
 */
const getFontPath = () => {
  if (process.platform === 'win32') {
    // Для Windows используем прямой путь, FFmpeg сам разберется в простых случаях
    return 'C:/Windows/Fonts/arial.ttf';
  }
  return '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
};
import { begetS3VideoService } from '../services/beget-s3-video-service';
import { directusApi } from '../directus';

const router = express.Router();
const upload = multer({ dest: 'uploads/temp/' });

// Хранилище SSE соединений для прогресса
const progressClients = new Map<string, express.Response>();

interface TextOverlay {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  startTime: number;
  endTime: number;
}

// Обработка видео с наложением текста
router.post('/process-video', authMiddleware, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Видео файл не найден' });
    }

    const { textOverlays } = req.body;
    const overlays: TextOverlay[] = JSON.parse(textOverlays || '[]');
    
    const inputPath = req.file.path;
    const outputFileName = `processed_${Date.now()}_${req.file.originalname}`;
    const outputPath = path.join('uploads/processed/', outputFileName);

    // Ensure output directory exists
    if (!fs.existsSync('uploads/processed/')) {
      fs.mkdirSync('uploads/processed/', { recursive: true });
    }

    console.log('[VIDEO] Processing video with text overlays:', {
      inputPath,
      outputPath,
      overlaysCount: overlays.length
    });

    let command = ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .format('mp4')
      .fps(30);

    // Добавляем текстовые overlays с правильным разрешением для Instagram Stories
    // Добавляем текстовые overlays с поддержкой UTF-8
    if (overlays.length > 0) {
      // Генерируем видео в Instagram Stories формате 1080x1920 для качества
      let videoFilter = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';
      
      overlays.forEach((overlay, index) => {
        const escapedText = overlay.text.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/,/g, "\\,");
        const fontColor = overlay.color.replace('#', '');
        
        // Используем реальные временные интервалы из overlay
        const startTime = overlay.startTime || 0;
        const endTime = overlay.endTime || 60;
        
        // Пересчитываем координаты для Instagram Stories формата (1080x1920)
        // Превью: 280x497px -> FFmpeg: 1080x1920px
        const scaleX = 1080 / 280; // ~3.86
        const scaleY = 1920 / 497;  // ~3.86
        
        // НЕ МАСШТАБИРУЕМ! Координаты из редактора уже подходят для 9:16
        // Используем координаты напрямую, только корректируем под разрешение
        // Координаты уже масштабированы в редакторе (x3), используем их напрямую!
        const finalX = Math.round(overlay.x * 1.3); // Легкое увеличение для 1080p
        const finalY = Math.round(overlay.y * 1.3); // Легкое увеличение для 1080p  
        const finalFontSize = Math.round(overlay.fontSize * 1.0); // Размер шрифта как есть
        
        console.log(`[VIDEO] Overlay ${index + 1} coordinates:`, {
          original: { x: overlay.x, y: overlay.y, fontSize: overlay.fontSize },
          final: { x: finalX, y: finalY, fontSize: finalFontSize }
        });
        
        const fontFile = getFontPath().replace(/\\/g, '/').replace(/:/g, '\\:');
        videoFilter += `,drawtext=fontfile='${fontFile}':text='${escapedText}':` +
          `x=${finalX}:y=${finalY}:` +
          `fontsize=${finalFontSize}:` +
          `fontcolor=0x${fontColor}:` +
          `enable='between(t\\,${startTime}\\,${endTime})'`;
      });

      command = command.videoFilters(videoFilter);
    } else {
      // Даже без текста, обеспечиваем правильный формат для Instagram Stories
      command = command.videoFilters('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
    }

    command
      .on('start', (commandLine: string) => {
        console.log('[VIDEO] FFmpeg command:', commandLine);
      })
      .on('progress', (progress: any) => {
        console.log(`[VIDEO] Processing: ${Math.round(progress.percent || 0)}%`);
      })
      .on('end', () => {
        console.log('[VIDEO] Processing finished successfully');
        
        // Удаляем временный файл
        fs.unlinkSync(inputPath);
        
        res.json({
          success: true,
          videoUrl: `/uploads/processed/${outputFileName}`,
          message: 'Видео обработано успешно'
        });
      })
      .on('error', (err: any) => {
        console.error('[VIDEO] FFmpeg error:', err);
        
        // Удаляем временный файл при ошибке
        if (fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
        }
        
        res.status(500).json({
          error: 'Ошибка обработки видео',
          details: err.message
        });
      })
      .save(outputPath);

  } catch (error) {
    console.error('[VIDEO] Error processing video:', error);
    res.status(500).json({
      error: 'Внутренняя ошибка сервера',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

// Получение информации о видео
router.post('/video-info', authMiddleware, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Видео файл не найден' });
    }

    const inputPath = req.file.path;

    ffmpeg.ffprobe(inputPath, (err: any, metadata: any) => {
      // Удаляем временный файл
      fs.unlinkSync(inputPath);

      if (err) {
        console.error('[VIDEO] Error getting video info:', err);
        return res.status(500).json({ error: 'Ошибка получения информации о видео' });
      }

      const videoStream = metadata.streams.find((stream: any) => stream.codec_type === 'video');
      
      res.json({
        success: true,
        duration: metadata.format.duration,
        width: videoStream?.width,
        height: videoStream?.height,
        bitrate: metadata.format.bit_rate,
        size: metadata.format.size
      });
    });

  } catch (error) {
    console.error('[VIDEO] Error getting video info:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Обработка видео по URL с наложением текста
router.post('/process-video-from-url', authMiddleware, async (req, res) => {
  console.log('[VIDEO] Starting process-video-from-url endpoint');
  console.log('[VIDEO] Request body:', req.body);
  try {
    const { videoUrl, textOverlays, campaignId, contentId } = req.body;
    const progressId = req.body.progressId || Date.now().toString();
    const storyId = contentId || campaignId; // contentId или campaignId - это ID stories в Directus

    console.log('[VIDEO] progressId:', progressId);
    console.log('[VIDEO] storyId (contentId/campaignId):', storyId);
    
    if (!videoUrl) {
      return res.status(400).json({ error: 'URL видео не указан' });
    }

    const overlays: TextOverlay[] = textOverlays || [];
    
    console.log('[VIDEO] Processing video from URL with text overlays:', {
      videoUrl,
      overlaysCount: overlays.length,
      overlays: overlays
    });

    // Скачиваем видео с сервера
    const videoResponse = await fetch(videoUrl);
    
    if (!videoResponse.ok) {
      throw new Error(`Не удалось скачать видео: ${videoResponse.status}`);
    }
    
    const videoBuffer = await videoResponse.arrayBuffer();
    
    // Создаем временный файл для входного видео
    const inputFileName = `temp_input_${Date.now()}.mp4`;
    const inputPath = path.resolve(process.cwd(), 'uploads/temp/', inputFileName);
    
    // Ensure temp directory exists
    const tempDir = path.resolve(process.cwd(), 'uploads/temp/');
    console.log('[VIDEO] Temp directory path:', tempDir);
    if (!fs.existsSync(tempDir)) {
      console.log('[VIDEO] Creating temp directory...');
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Записываем видео во временный файл
    console.log('[VIDEO] Writing input file to:', inputPath);
    console.log('[VIDEO] Video buffer size:', videoBuffer.byteLength);
    
    try {
      fs.writeFileSync(inputPath, Buffer.from(videoBuffer));
      console.log('[VIDEO] File written successfully');
      
      // Проверяем что файл действительно создан
      if (fs.existsSync(inputPath)) {
        const stats = fs.statSync(inputPath);
        console.log('[VIDEO] File size on disk:', stats.size, 'bytes');
      } else {
        throw new Error('File was not created');
      }
    } catch (writeError) {
      console.error('[VIDEO] Error writing input file:', writeError);
      throw new Error(`Failed to save input video: ${writeError.message}`);
    }

    const outputFileName = `processed_${Date.now()}.mp4`;
    const outputPath = path.join(tempDir, outputFileName);

    // Используем /tmp для выходного файла (более надежно в Docker)
    console.log('[VIDEO] Using /tmp for output file for better Docker compatibility');
    
    console.log('[VIDEO] Output file will be:', outputPath);

    let command = ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .format('mp4')
      .fps(30);

    // Добавляем текстовые overlays с правильным разрешением для Instagram Stories
    // Добавляем текстовые overlays с поддержкой UTF-8
    if (overlays.length > 0) {
      // Генерируем видео в Instagram Stories формате 1080x1920 для качества
      let videoFilter = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';
      
      overlays.forEach((overlay, index) => {
        const escapedText = overlay.text.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/,/g, "\\,");
        const fontColor = overlay.color.replace('#', '');
        
        // Используем реальные временные интервалы из overlay
        const startTime = overlay.startTime || 0;
        const endTime = overlay.endTime || 60;
        
        // Пересчитываем координаты для Instagram Stories формата (1080x1920)
        // Превью: 280x497px -> FFmpeg: 1080x1920px
        const scaleX = 1080 / 280; // ~3.86
        const scaleY = 1920 / 497;  // ~3.86
        
        // НЕ МАСШТАБИРУЕМ! Координаты из редактора уже подходят для 9:16
        // Используем координаты напрямую, только корректируем под разрешение
        // Координаты уже масштабированы в редакторе (x3), используем их напрямую!
        const finalX = Math.round(overlay.x * 1.3); // Легкое увеличение для 1080p
        const finalY = Math.round(overlay.y * 1.3); // Легкое увеличение для 1080p  
        const finalFontSize = Math.round(overlay.fontSize * 1.0); // Размер шрифта как есть
        
        console.log(`[VIDEO] Overlay ${index + 1} coordinates:`, {
          original: { x: overlay.x, y: overlay.y, fontSize: overlay.fontSize },
          final: { x: finalX, y: finalY, fontSize: finalFontSize }
        });
        
        const fontFile = getFontPath().replace(/\\/g, '/').replace(/:/g, '\\:');
        videoFilter += `,drawtext=fontfile='${fontFile}':text='${escapedText}':` +
          `x=${finalX}:y=${finalY}:` +
          `fontsize=${finalFontSize}:` +
          `fontcolor=0x${fontColor}:` +
          `enable='between(t\\,${startTime}\\,${endTime})'`;
      });

      command = command.videoFilters(videoFilter);
    } else {
      // Даже без текста, обеспечиваем правильный формат для Instagram Stories
      command = command.videoFilters('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
    }

    command
      .on('start', (commandLine: string) => {
        console.log('[VIDEO] FFmpeg command:', commandLine);
      })
      .on('progress', (progress: any) => {
        const percent = Math.round(progress.percent || 0);
        console.log(`[VIDEO] Processing: ${percent}%`);
        
        // Отправляем прогресс клиенту
        const client = progressClients.get(progressId);
        if (client) {
          client.write(`data: ${JSON.stringify({ 
            type: 'progress', 
            percent,
            message: `Обработка видео: ${percent}%`
          })}\n\n`);
        }
      })
      .on('end', async () => {
        console.log('[VIDEO] Processing finished successfully');
        
        try {
          // Загружаем обработанное видео на S3
          console.log('[VIDEO] Uploading processed video to S3...');
          const s3Result = await begetS3VideoService.uploadLocalVideo(outputPath, false);
          
          if (!s3Result.success) {
            throw new Error(`Failed to upload to S3: ${s3Result.error}`);
          }
          
          console.log('[VIDEO] Video uploaded to S3:', s3Result.videoUrl);

          // Сохраняем URL в Directus additional_media
          if (storyId) {
            try {
              console.log('[VIDEO] Saving video URL to Directus additional_media for storyId:', storyId);

              const additionalMediaData = [{
                type: 'generated_video',
                url: s3Result.videoUrl,
                generated_at: new Date().toISOString(),
                purpose: 'stories_publication'
              }];

              await directusApi.patch(`/items/campaign_content/${storyId}`, {
                additional_media: JSON.stringify(additionalMediaData),
                updated_at: new Date().toISOString()
              }, {
                headers: {
                  'Authorization': req.headers.authorization
                }
              });

              console.log('[VIDEO] Successfully saved video URL to Directus additional_media');

              // Отправляем на публикацию через n8n webhook (fire-and-forget, не ждём ответа)
              const publishAfter = req.body.publishAfter !== false; // По умолчанию публикуем
              if (publishAfter) {
                const { getN8nUrl } = await import('../utils/n8n-utils');
                const n8nUrl = getN8nUrl();
                const webhookUrl = `${n8nUrl}/webhook/publish-stories`;

                console.log('[VIDEO] Sending to n8n webhook for publication (fire-and-forget):', webhookUrl);

                fetch(webhookUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contentId: storyId })
                }).catch((err: any) => {
                  console.error('[VIDEO] n8n webhook error (non-blocking):', err?.message);
                });
              } else {
                console.log('[VIDEO] publishAfter=false, skipping n8n webhook');
              }
            } catch (directusError: any) {
              console.error('[VIDEO] Failed to save to Directus:', directusError?.response?.data || directusError?.message);
              // Продолжаем работу - видео уже загружено на S3
            }
          } else {
            console.log('[VIDEO] WARNING: No storyId provided, skipping Directus save');
          }

          // Отправляем уведомление о завершении
          console.log('[VIDEO] Looking for SSE client with progressId:', progressId);
          console.log('[VIDEO] Available progressIds:', Array.from(progressClients.keys()));

          const client = progressClients.get(progressId);
          if (client) {
            console.log('[VIDEO] SSE client found, sending complete event...');
            client.write(`data: ${JSON.stringify({
              type: 'complete',
              percent: 100,
              videoUrl: s3Result.videoUrl,
              message: 'Видео обработано и загружено!'
            })}\n\n`);
            client.end();
            progressClients.delete(progressId);
            console.log('[VIDEO] SSE complete event sent successfully');
          } else {
            console.log('[VIDEO] WARNING: No SSE client found for progressId:', progressId);
          }
          
          // Удаляем временные файлы
          fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
          
          res.json({
            success: true,
            videoUrl: s3Result.videoUrl,
            storyId: storyId,
            savedToDirectus: !!storyId,
            publishedToN8n: !!storyId && req.body.publishAfter !== false,
            message: storyId
              ? 'Видео обработано, сохранено в Directus и отправлено на публикацию'
              : 'Видео обработано и загружено на S3'
          });
          
        } catch (uploadError) {
          console.error('[VIDEO] Error uploading to S3:', uploadError);
          
          // Отправляем уведомление об ошибке загрузки
          const client = progressClients.get(progressId);
          if (client) {
            client.write(`data: ${JSON.stringify({ 
              type: 'error', 
              percent: 0,
              message: 'Ошибка загрузки видео на S3',
              error: uploadError instanceof Error ? uploadError.message : 'Неизвестная ошибка'
            })}\n\n`);
            client.end();
            progressClients.delete(progressId);
          }
          
          // Удаляем временные файлы
          fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
          
          res.status(500).json({
            error: 'Ошибка загрузки видео на S3',
            details: uploadError instanceof Error ? uploadError.message : 'Неизвестная ошибка'
          });
        }
      })
      .on('error', (err: any) => {
        console.error('[VIDEO] FFmpeg error:', err);
        
        // Отправляем уведомление об ошибке
        const client = progressClients.get(progressId);
        if (client) {
          client.write(`data: ${JSON.stringify({ 
            type: 'error', 
            percent: 0,
            message: 'Ошибка обработки видео',
            error: err.message
          })}\n\n`);
          client.end();
          progressClients.delete(progressId);
        }
        
        // Удаляем временные файлы при ошибке
        if (fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
        }
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        
        res.status(500).json({
          error: 'Ошибка обработки видео',
          details: err.message
        });
      })
      .save(outputPath);

  } catch (error) {
    console.error('[VIDEO] Error processing video from URL:', error);
    
    // Отправляем уведомление об ошибке
    const client = progressClients.get(progressId);
    if (client) {
      client.write(`data: ${JSON.stringify({ 
        type: 'error', 
        percent: 0,
        message: 'Внутренняя ошибка сервера',
        error: error instanceof Error ? error.message : 'Неизвестная ошибка'
      })}\n\n`);
      client.end();
      progressClients.delete(progressId);
    }
    
    res.status(500).json({
      error: 'Внутренняя ошибка сервера',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

// SSE эндпоинт для прогресса
router.get('/progress/:progressId', (req, res) => {
  const progressId = req.params.progressId;
  console.log('[VIDEO-SSE] New SSE connection for progressId:', progressId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Сохраняем соединение
  progressClients.set(progressId, res);
  console.log('[VIDEO-SSE] SSE client registered. Total clients:', progressClients.size);

  // Отправляем начальное сообщение
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    message: 'Соединение установлено'
  })}\n\n`);

  // Очистка при отключении
  req.on('close', () => {
    console.log('[VIDEO-SSE] SSE connection closed for progressId:', progressId);
    progressClients.delete(progressId);
    console.log('[VIDEO-SSE] Remaining clients:', progressClients.size);
  });
});

export default router;