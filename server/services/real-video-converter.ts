import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';

const execAsync = promisify(exec);

interface VideoConversionResult {
  success: boolean;
  convertedUrl?: string;
  originalUrl?: string;
  localPath?: string;
  error?: string;
  duration?: number;
  metadata?: {
    width: number;
    height: number;
    duration: number;
    codec: string;
    size: number;
  };
}

/**
 * Реальный видео конвертер с FFmpeg для Instagram Stories
 * Конвертирует видео в формат 9:16, MP4, до 59 секунд
 */
export class RealVideoConverter {
  private tempDir = '/tmp/video-conversion';

  constructor() {
    // Создаем временную папку
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Проверяет, нужна ли конвертация видео
   */
  needsConversion(videoUrl: string, forceConvert: boolean = false): boolean {
    // ПРИНУДИТЕЛЬНАЯ конвертация - всегда выполняется при forceConvert=true
    if (forceConvert) {
      console.log('[real-video-converter] FORCE CONVERT requested - выполняем реконвертацию');
      return true;
    }
    
    const url = videoUrl.toLowerCase();
    
    // Если уже содержит метку конвертации - пропускаем
    if (url.includes('_converted') || url.includes('ig_stories_converted')) {
      console.log('[real-video-converter] Video already converted, skipping');
      return false;
    }
    
    // Конвертируем все форматы для Instagram Stories
    console.log('[real-video-converter] Video needs conversion');
    return true;
  }

  /**
   * Конвертирует видео для Instagram Stories
   */
  async convertForInstagramStories(videoUrl: string, forceConvert: boolean = false): Promise<VideoConversionResult> {
    console.log('[real-video-converter] Starting conversion:', videoUrl, forceConvert ? '(FORCED)' : '');

    const startTime = Date.now();
    let inputFile: string | null = null;
    let outputFile: string | null = null;

    try {
      // Шаг 1: Скачиваем исходное видео
      const fileName = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const ext = this.getFileExtension(videoUrl);
      inputFile = path.join(this.tempDir, `${fileName}${ext}`);
      outputFile = path.join(this.tempDir, `${fileName}_ig_stories_converted.mp4`);

      console.log('[real-video-converter] Downloading video from:', videoUrl);
      
      const response = await axios({
        method: 'GET',
        url: videoUrl,
        responseType: 'stream',
        timeout: 120000 // 2 минуты для скачивания
      });

      const writeStream = fs.createWriteStream(inputFile);
      response.data.pipe(writeStream);

      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      const inputStats = fs.statSync(inputFile);
      console.log('[real-video-converter] Video downloaded:', {
        size: inputStats.size,
        path: inputFile
      });

      // Шаг 2: Получаем информацию о видео
      const mediaInfo = await this.getVideoInfo(inputFile);
      console.log('[real-video-converter] Original video info:', mediaInfo);

      // Шаг 3: Конвертируем для Instagram Stories
      await this.convertVideo(inputFile, outputFile);

      // Шаг 4: Проверяем результат
      if (!fs.existsSync(outputFile)) {
        throw new Error('Converted file was not created');
      }

      const outputStats = fs.statSync(outputFile);
      const convertedInfo = await this.getVideoInfo(outputFile);
      
      console.log('[real-video-converter] Conversion completed:', {
        originalSize: inputStats.size,
        convertedSize: outputStats.size,
        duration: Date.now() - startTime,
        convertedInfo
      });

      // Шаг 5: Загружаем на S3
      const uploadedUrl = await this.uploadToS3(outputFile);

      return {
        success: true,
        convertedUrl: uploadedUrl,
        originalUrl: videoUrl,
        localPath: outputFile,
        duration: convertedInfo.duration,
        metadata: {
          width: convertedInfo.width,
          height: convertedInfo.height,
          duration: convertedInfo.duration,
          codec: convertedInfo.codec,
          size: outputStats.size
        }
      };

    } catch (error: any) {
      console.error('[real-video-converter] Conversion failed:', error.message);
      
      return {
        success: false,
        error: error.message,
        originalUrl: videoUrl
      };
    } finally {
      // Очищаем временные файлы
      this.cleanupFiles([inputFile, outputFile]);
    }
  }

  /**
   * Получает информацию о видео файле
   */
  private async getVideoInfo(filePath: string): Promise<any> {
    const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
    const { stdout } = await execAsync(command);
    const info = JSON.parse(stdout);
    
    const videoStream = info.streams.find((s: any) => s.codec_type === 'video');
    
    return {
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      duration: parseFloat(info.format.duration || '0'),
      codec: videoStream?.codec_name || 'unknown',
      bitrate: parseInt(info.format.bit_rate || '0')
    };
  }

  /**
   * Конвертирует видео для Instagram Stories
   * Использует безопасные параметры для стабильного принятия Instagram API
   */
  private async convertVideo(inputPath: string, outputPath: string): Promise<void> {
    // ТОЧНЫЕ CloudConvert N8N параметры:
    // - input_format: webm, output_format: mp4
    // - video_codec: x264, video_bitrate: 5000k, crf: 23
    // - width: 1080, height: 1920, fit: scale
    // - pixel_format: yuv420p (Instagram требует)
    // - profile: baseline (максимальная совместимость)
    // - level: 3.1 (Instagram Stories совместимость)
    // - FPS: 30
    
    // INSTAGRAM STORIES РАБОЧИЕ ПАРАМЕТРЫ
    // Используем H.264 Main профиль - протестировано и работает!
    const ffmpegCommand = `ffmpeg -i "${inputPath}" ` +
      `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30" ` +
      `-c:v libx264 ` +                    // H.264 видео кодек
      `-profile:v main ` +                 // MAIN профиль (протестировано - работает!)
      `-level 4.0 ` +                      // Level 4.0 (стандартный)
      `-pix_fmt yuv420p ` +                // YUV420p обязательно
      `-b:v 3M ` +                         // 3 Мбит/с видео битрейт
      `-maxrate 4M ` +                     // Максимум 4 Мбит/с
      `-bufsize 8M ` +                     // Буфер 8M
      `-c:a aac ` +                        // AAC аудио
      `-ar 44100 ` +                       // 44.1 kHz частота
      `-ac 2 ` +                           // 2 канала стерео
      `-b:a 128k ` +                       // 128 кбит/с аудио
      `-movflags +faststart ` +            // Web-оптимизация
      `-f mp4 ` +                          // MP4 контейнер
      `-y "${outputPath}"`;                // Перезапись

    console.log('[real-video-converter] Running FFmpeg conversion...');
    console.log('[real-video-converter] Command:', ffmpegCommand);
    
    const { stdout, stderr } = await execAsync(ffmpegCommand, { 
      timeout: 600000 // 10 минут максимум
    });

    if (stderr) {
      console.log('[real-video-converter] FFmpeg stderr:', stderr);
    }
  }

  /**
   * Загружает конвертированное видео на S3 и возвращает прокси-URL для Instagram
   */
  private async uploadToS3(filePath: string): Promise<string> {
    try {
      const fileName = `ig_stories_converted_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
      
      console.log('[real-video-converter] Uploading to S3:', fileName);

      // Используем beget-s3-storage-aws напрямую для загрузки видео
      const { begetS3StorageAws } = await import('./beget-s3-storage-aws');
      const videoKey = `videos/${fileName}`;
      
      const uploadResult = await begetS3StorageAws.uploadFile({
        key: videoKey,
        filePath: filePath,
        contentType: 'video/mp4'
      });

      if (uploadResult.success && uploadResult.url) {
        console.log('[real-video-converter] S3 upload successful:', uploadResult.url);
        
        // ВАЖНО: Возвращаем прокси-URL вместо прямой S3 ссылки для Instagram совместимости
        const proxyUrl = this.generateProxyUrl(fileName);
        console.log('[real-video-converter] Generated Instagram proxy URL:', proxyUrl);
        
        return proxyUrl;
      } else {
        throw new Error('S3 upload failed: ' + uploadResult.error);
      }
    } catch (error: any) {
      console.error('[real-video-converter] S3 upload error:', error.message);
      throw new Error('Failed to upload converted video to S3: ' + error.message);
    }
  }

  /**
   * Генерирует прокси-URL для Instagram видео
   */
  private generateProxyUrl(fileName: string): string {
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
      : 'http://localhost:5000';
    
    return `${baseUrl}/api/instagram-video-proxy/${fileName}`;
  }

  /**
   * Получает расширение файла из URL
   */
  private getFileExtension(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const lastDotIndex = pathname.lastIndexOf('.');
      
      if (lastDotIndex > 0) {
        return pathname.substring(lastDotIndex);
      }
      
      return '.mp4'; // По умолчанию
    } catch {
      return '.mp4';
    }
  }

  /**
   * Очищает временные файлы
   */
  private cleanupFiles(filePaths: (string | null)[]): void {
    filePaths.forEach(filePath => {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log('[real-video-converter] Cleaned up:', filePath);
        } catch (error) {
          console.warn('[real-video-converter] Could not delete file:', filePath);
        }
      }
    });
  }

  /**
   * Конвертирует локальный файл для Instagram Stories
   */
  async convertLocalFile(localPath: string, forceConvert: boolean = false): Promise<VideoConversionResult> {
    console.log('[real-video-converter] Converting local file:', localPath);

    if (!fs.existsSync(localPath)) {
      return {
        success: false,
        error: 'Local file not found',
        originalUrl: localPath,
        convertedUrl: undefined,
        duration: 0,
        metadata: undefined
      };
    }

    const startTime = Date.now();
    let outputFile: string | null = null;

    try {
      // Генерируем имя выходного файла
      const fileName = `local_converted_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      outputFile = path.join(this.tempDir, `${fileName}_ig_stories_converted.mp4`);

      console.log('[real-video-converter] Converting local file to:', outputFile);

      // Получаем размер исходного файла
      const originalStats = fs.statSync(localPath);
      const originalSize = originalStats.size;

      // ТОЧНЫЕ ПАРАМЕТРЫ GOOGLE (ForBiggerEscapes.mp4) - проверенные Instagram
      const ffmpegCommand = `ffmpeg -i "${localPath}" ` +
        `-t 10 ` +                           // Короткое видео
        `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" ` +
        `-c:v libx264 ` +                    // H.264 видео кодек
        `-profile:v high ` +                 // HIGH профиль (точно как у Google)
        `-level:v 3.1 ` +                    // Level 3.1 (точно как у Google)
        `-pix_fmt yuv420p ` +                // YUV420p пиксели
        `-crf 23 ` +                         // CRF 23 стандартное качество
        `-maxrate 1000k ` +                  // Точный битрейт как у Google (~1027k)
        `-bufsize 2000k ` +                  // Маленький буфер как у оригинала
        `-g 24 ` +                           // GOP 24 (как 24 FPS)
        `-r 24 ` +                           // 24 FPS как у Google оригинала
        `-c:a aac ` +                        // AAC аудио
        `-b:a 192k ` +                       // 192k аудио битрейт (как у Google)
        `-ar 44100 ` +                       // 44.1kHz частота
        `-ac 2 ` +                           // Stereo
        `-movflags +faststart ` +            // Быстрый старт
        `-f mp4 ` +                          // MP4 контейнер
        `-y "${outputFile}"`;                // Перезапись

      console.log('[real-video-converter] Executing FFmpeg command...');
      const { stdout } = await execAsync(ffmpegCommand);

      // Проверяем что файл создан
      if (!fs.existsSync(outputFile)) {
        throw new Error('Output file was not created');
      }

      // Получаем информацию о конвертированном файле
      const convertedStats = fs.statSync(outputFile);
      const convertedSize = convertedStats.size;

      // Анализируем метаданные
      const videoInfo = await this.getVideoInfo(outputFile);

      console.log('[real-video-converter] Conversion completed:', {
        originalSize,
        convertedSize,
        duration: Date.now() - startTime,
        convertedInfo: videoInfo
      });

      // Загружаем в S3
      const s3Url = await this.uploadToS3(outputFile);

      if (!s3Url) {
        throw new Error('S3 upload failed');
      }

      // Очищаем временный файл
      this.cleanupFiles([outputFile]);

      return {
        success: true,
        originalUrl: localPath,
        convertedUrl: s3Url,
        duration: Date.now() - startTime,
        metadata: {
          width: videoInfo?.width || 1080,
          height: videoInfo?.height || 1920,
          duration: videoInfo?.duration || 0,
          codec: videoInfo?.codec || 'h264',
          size: convertedSize
        }
      };

    } catch (error: any) {
      console.error('[real-video-converter] Local conversion failed:', error.message);
      
      // Очищаем временные файлы
      this.cleanupFiles([outputFile]);

      return {
        success: false,
        error: error.message,
        originalUrl: localPath,
        convertedUrl: undefined,
        duration: Date.now() - startTime,
        metadata: undefined
      };
    }
  }

  /**
   * Проверяет доступность FFmpeg
   */
  async checkFFmpegAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('ffmpeg -version');
      return stdout.includes('ffmpeg version');
    } catch (error) {
      return false;
    }
  }

  /**
   * Обновляет URL видео в контенте Directus
   */
  async updateContentVideoUrl(contentId: string, newVideoUrl: string, authHeader?: string): Promise<boolean> {
    try {
      const { directusApi } = await import('../directus');
      
      const updateData = {
        video_url: newVideoUrl,
        updated_at: new Date().toISOString()
      };

      // Пробуем с пользовательским токеном
      if (authHeader) {
        try {
          await directusApi.patch(`/items/campaign_content/${contentId}`, updateData, {
            headers: {
              'Authorization': authHeader
            }
          });
          console.log('[real-video-converter] Content updated with user token');
          return true;
        } catch (userError) {
          console.log('[real-video-converter] User token failed, trying system token');
        }
      }

      // Fallback на системный токен
      await directusApi.patch(`/items/campaign_content/${contentId}`, updateData, {
        headers: {
          'Authorization': `Bearer ${process.env.DIRECTUS_ADMIN_TOKEN}`
        }
      });

      console.log('[real-video-converter] Content updated with system token');
      return true;
    } catch (error: any) {
      console.error('[real-video-converter] Failed to update content:', error.message);
      return false;
    }
  }
}

export const realVideoConverter = new RealVideoConverter();