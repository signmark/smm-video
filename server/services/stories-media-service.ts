import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

// Инициализируем пути к ffmpeg и ffprobe
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import os from 'os';

/**
 * Получает путь к шрифту, поддерживающему кириллицу
 */
const getFontPath = () => {
  if (process.platform === 'win32') {
    // FFmpeg drawtext требует специфического экранирования пути на Windows
    // Используем формат с обратными слешами, которые будут экранированы внутри фильтра
    return 'C:/Windows/Fonts/arial.ttf';
  }
  // Путь для Linux (например, в Docker контейнере)
  return '/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf';
};
import {
  TextOverlay,
  scaleTextOverlayToInstagram,
  ADDITIONAL_MEDIA_TYPES,
  INSTAGRAM_STORIES_DIMENSIONS,
  getStoryMediaType,
} from '../../shared/stories-constants';
import { begetS3VideoService } from './beget-s3-video-service';
import { begetS3StorageAws } from './beget-s3-storage-aws';
import { directusApi } from '../directus';
import { v4 as uuidv4 } from 'uuid';

/**
 * Сервис для работы с медиа Stories
 * Централизует всю логику генерации изображений/видео с текстом
 * и управления полем additional_media
 */

export interface AdditionalMediaItem {
  type: string;
  url: string;
  generated_at: string;
  purpose?: string;
  metadata?: any;
}

export interface GenerateMediaWithTextOptions {
  mediaUrl: string;
  textOverlays: TextOverlay[];
  contentId: string;
  authToken: string;
}

export interface GenerateVideoWithTextOptions extends GenerateMediaWithTextOptions {}

export interface GenerateMediaResult {
  success: boolean;
  mediaUrl?: string;
  error?: string;
}

export interface GenerateVideoResult extends GenerateMediaResult {
  videoUrl?: string;
}

export interface GenerateImageResult extends GenerateMediaResult {
  imageUrl?: string;
}

export class StoriesMediaService {
  /**
   * Определяет тип медиа Stories (video или image)
   */
  static getMediaType(story: { video_url?: string | null; image_url?: string | null }): 'video' | 'image' {
    return getStoryMediaType(story);
  }

  /**
   * Генерирует изображение с текстовыми overlays на сервере
   */
  static async generateImageWithText(options: GenerateMediaWithTextOptions): Promise<GenerateImageResult> {
    const { mediaUrl, textOverlays, contentId, authToken } = options;

    try {
      console.log('[StoriesMediaService] Начинаем генерацию ИЗОБРАЖЕНИЯ с текстом:', {
        mediaUrl,
        textOverlaysCount: textOverlays.length,
        contentId,
      });

      // 1. Скачиваем фоновое изображение
      const imageResponse = await fetch(mediaUrl);
      if (!imageResponse.ok) {
        throw new Error(`Не удалось скачать изображение: ${imageResponse.status}`);
      }
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

      // 2. Подготавливаем фон (масштабируем под Instagram Story 1080x1920)
      let image = sharp(imageBuffer)
        .resize(1080, 1920, {
          fit: 'cover',
          position: 'center',
        });

      // 3. Создаем SVG слой для текста
      // Мы используем SVG, так как это проще всего для позиционирования текста с фонами
      let svgContent = `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">`;
      
      const scaledOverlays = textOverlays.map(overlay => {
        const rawX = overlay.x !== undefined ? overlay.x : (overlay.position?.x ?? 0);
        const rawY = overlay.y !== undefined ? overlay.y : (overlay.position?.y ?? 0);
        
        const cleanOverlay = {
          ...overlay,
          x: Number(rawX) || 0,
          y: Number(rawY) || 0,
          fontSize: Number(overlay.fontSize) || 24,
        };
        return scaleTextOverlayToInstagram(cleanOverlay);
      });

      for (const overlay of scaledOverlays) {
        const escapedText = overlay.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

        // Коэффициент размера шрифта для SVG (чуть больше чем для FFmpeg)
        const fontSize = Math.round(overlay.fontSize * 1.1);
        const x = overlay.x;
        const y = overlay.y;
        const color = overlay.color || '#ffffff';
        const bgColor = (overlay.backgroundColor && overlay.backgroundColor !== 'transparent') 
          ? overlay.backgroundColor 
          : null;

        // Если есть фон, рисуем прямоугольник
        if (bgColor) {
          // Приблизительный расчет ширины/высоты текста для фона
          // В идеале нужно использовать canvas.measureText, но для начала сделаем так
          const textWidth = escapedText.length * (fontSize * 0.6);
          const textHeight = fontSize * 1.2;
          const padding = 20;
          
          svgContent += `
            <rect 
              x="${x - padding}" 
              y="${y - fontSize + padding/2}" 
              width="${textWidth + padding * 2}" 
              height="${textHeight + padding}" 
              fill="${bgColor}" 
              rx="10"
            />`;
        } else {
          // Если фона нет, добавим тень через фильтр SVG
          svgContent += `
            <defs>
              <filter id="shadow${x}${y}" x="0" y="0" width="200%" height="200%">
                <feOffset result="offOut" in="SourceAlpha" dx="2" dy="2" />
                <feGaussianBlur result="blurOut" in="offOut" stdDeviation="3" />
                <feBlend in="SourceGraphic" in2="blurOut" mode="normal" />
              </filter>
            </defs>`;
        }

        svgContent += `
          <text 
            x="${x}" 
            y="${y}" 
            font-family="Arial, sans-serif" 
            font-size="${fontSize}" 
            fill="${color}"
            ${!bgColor ? `filter="url(#shadow${x}${y})"` : ''}
          >${escapedText}</text>`;
      }

      svgContent += `</svg>`;

      // 4. Накладываем SVG на изображение
      const finalImageBuffer = await image
        .composite([{
          input: Buffer.from(svgContent),
          top: 0,
          left: 0,
        }])
        .jpeg({ quality: 90 })
        .toBuffer();

      // 5. Загружаем на S3
      const fileName = `generated_story_${uuidv4()}.jpg`;
      const tempPath = path.join(os.tmpdir(), fileName);
      fs.writeFileSync(tempPath, finalImageBuffer);

      console.log('[StoriesMediaService] Загружаем изображение на S3...');
      const uploadResult = await begetS3StorageAws.uploadFile({
        key: `stories/${fileName}`,
        filePath: tempPath,
        contentType: 'image/jpeg',
      });

      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

      if (!uploadResult.success) {
        throw new Error(`Failed to upload image to S3: ${uploadResult.error}`);
      }

      const finalImageUrl = uploadResult.url!;
      console.log('[StoriesMediaService] Изображение загружено на S3:', finalImageUrl);

      // 6. Сохраняем в additional_media
      await this.saveToAdditionalMedia(
        contentId,
        finalImageUrl,
        ADDITIONAL_MEDIA_TYPES.GENERATED_IMAGE,
        authToken
      );

      return {
        success: true,
        mediaUrl: finalImageUrl,
        imageUrl: finalImageUrl,
      };
    } catch (error: any) {
      console.error('[StoriesMediaService] Ошибка генерации изображения:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Генерирует видео с текстовыми overlays
   * Автоматически масштабирует координаты и сохраняет результат в additional_media
   */
  static async generateVideoWithText(options: GenerateVideoWithTextOptions): Promise<GenerateVideoResult> {
    const { videoUrl, textOverlays, contentId, authToken } = options;

    try {
      console.log('[StoriesMediaService] Начинаем генерацию видео с текстом:', {
        videoUrl,
        textOverlaysCount: textOverlays.length,
        contentId,
      });

      // 1. Скачиваем видео
      const videoResponse = await fetch(videoUrl);
      if (!videoResponse.ok) {
        throw new Error(`Не удалось скачать видео: ${videoResponse.status}`);
      }
      const videoBuffer = await videoResponse.arrayBuffer();

      // 2. Создаем временные файлы
      const inputFileName = `temp_input_${Date.now()}.mp4`;
      const inputPath = path.resolve(process.cwd(), 'uploads/temp/', inputFileName);
      const tempDir = path.resolve(process.cwd(), 'uploads/temp/');

      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      fs.writeFileSync(inputPath, Buffer.from(videoBuffer));
      console.log('[StoriesMediaService] Видео скачано:', inputPath);

      const outputFileName = `processed_${Date.now()}.mp4`;
      const outputPath = path.join(tempDir, outputFileName);

      // 3. Масштабируем overlays для Instagram формата
      const scaledOverlays = textOverlays.map(overlay => {
        // Учитываем разные структуры метаданных (x vs position.x)
        const rawX = overlay.x !== undefined ? overlay.x : (overlay.position?.x ?? 0);
        const rawY = overlay.y !== undefined ? overlay.y : (overlay.position?.y ?? 0);
        
        const cleanOverlay = {
          ...overlay,
          x: Number(rawX) || 0,
          y: Number(rawY) || 0,
          fontSize: Number(overlay.fontSize) || 24,
        };
        return scaleTextOverlayToInstagram(cleanOverlay);
      });

      console.log('[StoriesMediaService] Overlays масштабированы:', {
        original: textOverlays[0],
        scaled: scaledOverlays[0],
      });

      // 4. Обрабатываем видео через FFmpeg
      await this.processVideoWithFFmpeg(inputPath, outputPath, scaledOverlays);

      // 5. Загружаем на S3
      console.log('[StoriesMediaService] Загружаем видео на S3...');
      const s3Result = await begetS3VideoService.uploadLocalVideo(outputPath, false);

      if (!s3Result.success) {
        throw new Error(`Failed to upload to S3: ${s3Result.error}`);
      }

      const finalVideoUrl = s3Result.videoUrl!;
      console.log('[StoriesMediaService] Видео загружено на S3:', finalVideoUrl);

      // 6. Удаляем временные файлы
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

      // 7. Сохраняем в additional_media
      await this.saveToAdditionalMedia(
        contentId,
        finalVideoUrl,
        ADDITIONAL_MEDIA_TYPES.GENERATED_VIDEO,
        authToken
      );

      return {
        success: true,
        videoUrl: finalVideoUrl,
      };
    } catch (error: any) {
      console.error('[StoriesMediaService] Ошибка генерации видео:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Обрабатывает видео через FFmpeg с текстовыми overlays
   */
  private static async processVideoWithFFmpeg(
    inputPath: string,
    outputPath: string,
    scaledOverlays: TextOverlay[]
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .format('mp4')
        .fps(30);

      // Строим фильтр для видео
      let videoFilter = `scale=${INSTAGRAM_STORIES_DIMENSIONS.WIDTH}:${INSTAGRAM_STORIES_DIMENSIONS.HEIGHT}:force_original_aspect_ratio=increase,crop=${INSTAGRAM_STORIES_DIMENSIONS.WIDTH}:${INSTAGRAM_STORIES_DIMENSIONS.HEIGHT}`;

      // Добавляем текстовые overlays
      if (scaledOverlays.length > 0) {
        scaledOverlays.forEach((overlay: TextOverlay) => {
          const escapedText = overlay.text
            .replace(/'/g, "\\'")
            .replace(/:/g, "\\:")
            .replace(/,/g, "\\,");
          
          // Используем относительные координаты FFmpeg для надежности
          // Рисуем от верхнего левого угла (как в редакторе), без text_w/2
          const xRel = (overlay.x / INSTAGRAM_STORIES_DIMENSIONS.WIDTH).toFixed(4);
          const yRel = (overlay.y / INSTAGRAM_STORIES_DIMENSIONS.HEIGHT).toFixed(4);
          
          // Коэффициент 1.3 дает итоговый масштаб ~4.0x (3.08 * 1.3)
          const adjustedFontSize = Math.max(16, Math.round(overlay.fontSize * 1.3));
          
          const fontFile = getFontPath().replace(/\\/g, '/').replace(/:/g, '\\:');
          
          videoFilter += `,drawtext=fontfile='${fontFile}':text='${escapedText}':` +
            `x=w*${xRel}:y=h*${yRel}:` +
            `fontsize=${adjustedFontSize}:` +
            `fix_bounds=1:` +
            `fontcolor=0x${overlay.color.replace('#', '')}:`;
            
          // Добавляем фон (box), если он есть
          if (overlay.backgroundColor && overlay.backgroundColor !== 'transparent') {
            videoFilter += `box=1:boxcolor='${overlay.backgroundColor}':boxborderw=12:`;
          } else {
            // Если фона нет, добавим небольшую тень для читаемости на любом фоне
            videoFilter += `shadowcolor=black@0.6:shadowx=3:shadowy=3:`;
          }
          
          videoFilter += `enable='between(t\\,${overlay.startTime}\\,${overlay.endTime})'`;
        });
      }

      command = command.videoFilters(videoFilter);

      command
        .on('start', (commandLine: string) => {
          console.log('[StoriesMediaService] FFmpeg command:', commandLine);
        })
        .on('progress', (progress: any) => {
          const percent = Math.round(progress.percent || 0);
          console.log(`[StoriesMediaService] Processing: ${percent}%`);
        })
        .on('end', () => {
          console.log('[StoriesMediaService] FFmpeg обработка завершена');
          resolve();
        })
        .on('error', (err: any) => {
          console.error('[StoriesMediaService] FFmpeg error:', err);
          reject(err);
        })
        .save(outputPath);
    });
  }

  /**
   * Сохраняет URL медиа в поле additional_media контента
   * Автоматически очищает старые сгенерированные медиа того же типа
   */
  static async saveToAdditionalMedia(
    contentId: string,
    mediaUrl: string,
    mediaType: string,
    authToken: string
  ): Promise<void> {
    try {
      console.log('[StoriesMediaService] Сохраняем медиа в additional_media:', {
        contentId,
        mediaUrl,
        mediaType,
      });

      // Получаем текущий контент
      const response = await directusApi.get(`/items/campaign_content/${contentId}`, {
        headers: {
          'Authorization': authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`,
        },
      });

      const story = response.data.data;
      let currentAdditionalMedia: AdditionalMediaItem[] = [];

      // Парсим текущий additional_media
      if (story.additional_media) {
        try {
          const parsed = typeof story.additional_media === 'string'
            ? JSON.parse(story.additional_media)
            : story.additional_media;

          if (Array.isArray(parsed)) {
            // Удаляем старые сгенерированные медиа (generated_video, generated_image, instagram_ready_image)
            currentAdditionalMedia = parsed.filter((item: AdditionalMediaItem) =>
              item.type !== ADDITIONAL_MEDIA_TYPES.GENERATED_VIDEO &&
              item.type !== ADDITIONAL_MEDIA_TYPES.GENERATED_IMAGE &&
              item.type !== ADDITIONAL_MEDIA_TYPES.INSTAGRAM_READY_IMAGE
            );
          }
        } catch (e) {
          console.warn('[StoriesMediaService] Ошибка парсинга additional_media:', e);
          currentAdditionalMedia = [];
        }
      }

      // Добавляем новое медиа в НАЧАЛО массива: публикация берёт [0]
      currentAdditionalMedia.unshift({
        type: mediaType,
        url: mediaUrl,
        generated_at: new Date().toISOString(),
        purpose: 'stories_publication',
      });

      // Сохраняем обратно в Directus
      await directusApi.patch(`/items/campaign_content/${contentId}`, {
        additional_media: JSON.stringify(currentAdditionalMedia),
      }, {
        headers: {
          'Authorization': authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`,
        },
      });

      console.log('[StoriesMediaService] additional_media обновлено успешно');
    } catch (error: any) {
      console.error('[StoriesMediaService] Ошибка сохранения в additional_media:', error);
      throw error;
    }
  }

  /**
   * Получает медиа из additional_media по типу
   */
  static async getMediaFromAdditionalMedia(
    contentId: string,
    mediaType: string,
    authToken: string
  ): Promise<string | null> {
    try {
      const response = await directusApi.get(`/items/campaign_content/${contentId}`, {
        headers: {
          'Authorization': authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`,
        },
      });

      const story = response.data.data;

      if (!story.additional_media) {
        return null;
      }

      const parsed = typeof story.additional_media === 'string'
        ? JSON.parse(story.additional_media)
        : story.additional_media;

      if (!Array.isArray(parsed)) {
        return null;
      }

      const mediaItem = parsed.find((item: AdditionalMediaItem) => item.type === mediaType);
      return mediaItem?.url || null;
    } catch (error: any) {
      console.error('[StoriesMediaService] Ошибка получения медиа из additional_media:', error);
      return null;
    }
  }

  /**
   * Проверяет, нужно ли генерировать медиа с текстом
   */
  static needsMediaGeneration(story: any): boolean {
    if (!story.metadata) return false;

    try {
      const metadata = typeof story.metadata === 'string'
        ? JSON.parse(story.metadata)
        : story.metadata;

      const textOverlays = metadata.textOverlays || [];
      return textOverlays.length > 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Извлекает textOverlays из metadata
   */
  static getTextOverlaysFromMetadata(story: any): TextOverlay[] {
    if (!story.metadata) return [];

    try {
      const metadata = typeof story.metadata === 'string'
        ? JSON.parse(story.metadata)
        : story.metadata;

      return metadata.textOverlays || [];
    } catch (e) {
      console.warn('[StoriesMediaService] Ошибка парсинга metadata:', e);
      return [];
    }
  }
}

export default StoriesMediaService;
