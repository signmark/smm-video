/**
 * Специализированный сервис для работы с видео в Beget S3
 */
import { begetS3StorageAws } from './beget-s3-storage-aws';
import { log } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

export interface VideoMetadata {
  width?: number;
  height?: number;
  duration?: number;
  format?: string;
  size?: number;
  bitrate?: number;
  codec?: string;
}

export interface UploadVideoResult {
  success: boolean;
  videoUrl?: string;
  thumbnailUrl?: string;
  metadata?: VideoMetadata;
  key?: string;
  error?: string;
}

export class BegetS3VideoService {
  private logPrefix = 'beget-s3-video';
  private videoFolder = 'videos';
  private thumbnailFolder = 'thumbnails';

  /**
   * Загружает видео в Beget S3 из URL
   * @param videoUrl URL видео
   * @param generateThumbnail Флаг для генерации превью видео
   * @returns Результат загрузки видео
   */
  async uploadVideoFromUrl(videoUrl: string, generateThumbnail: boolean = true): Promise<UploadVideoResult> {
    try {
      log.info(`Uploading video from URL: ${videoUrl}`, this.logPrefix);
      
      // Загружаем видео в S3
      const uploadResult = await begetS3StorageAws.uploadFromUrl(
        videoUrl,
        undefined, // автоматическое определение имени файла
        undefined, // автоматическое определение типа контента
        this.videoFolder
      );

      if (!uploadResult.success) {
        throw new Error(`Failed to upload video: ${uploadResult.error}`);
      }

      log.info(`Video uploaded successfully: ${uploadResult.url}`, this.logPrefix);
      
      let thumbnailUrl: string | undefined;
      
      // Если нужно сгенерировать превью
      if (generateThumbnail && uploadResult.url) {
        try {
          const thumbnailResult = await this.generateAndUploadThumbnail(uploadResult.url);
          if (thumbnailResult.success && thumbnailResult.url) {
            thumbnailUrl = thumbnailResult.url;
            log.info(`Thumbnail generated and uploaded: ${thumbnailUrl}`, this.logPrefix);
          }
        } catch (thumbnailError) {
          log.error(`Error generating thumbnail: ${(thumbnailError as Error).message}`, this.logPrefix);
          // Продолжаем выполнение даже если превью не сгенерировалось
        }
      }
      
      // Можем попытаться получить метаданные видео, но это не критично для успеха операции
      let metadata: VideoMetadata | undefined;
      try {
        metadata = await this.extractVideoMetadata(uploadResult.url as string);
      } catch (metadataError) {
        log.error(`Error extracting video metadata: ${(metadataError as Error).message}`, this.logPrefix);
      }
      
      return {
        success: true,
        videoUrl: uploadResult.url,
        thumbnailUrl,
        metadata,
        key: uploadResult.key
      };
    } catch (error) {
      log.error(`Error uploading video from URL: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Загружает локальное видео в Beget S3
   * @param filePath Путь к локальному видеофайлу
   * @param generateThumbnail Флаг для генерации превью видео
   * @returns Результат загрузки видео
   */
  async uploadLocalVideo(filePath: string, generateThumbnail: boolean = true): Promise<UploadVideoResult> {
    try {
      log.info(`Uploading local video: ${filePath}`, this.logPrefix);
      
      if (!fs.existsSync(filePath)) {
        throw new Error(`Video file not found: ${filePath}`);
      }
      
      // Загружаем видео в S3
      const uploadResult = await begetS3StorageAws.uploadLocalFile(
        filePath,
        undefined, // используем имя локального файла
        undefined, // автоматическое определение типа контента
        this.videoFolder
      );

      if (!uploadResult.success) {
        throw new Error(`Failed to upload video: ${uploadResult.error}`);
      }

      log.info(`Video uploaded successfully: ${uploadResult.url}`, this.logPrefix);
      
      let thumbnailUrl: string | undefined;
      
      // Если нужно сгенерировать превью
      if (generateThumbnail && uploadResult.url) {
        try {
          // Можно сгенерировать превью либо из загруженного URL, либо из локального файла
          // В данном случае используем URL, так как файл уже загружен
          const thumbnailResult = await this.generateAndUploadThumbnail(uploadResult.url);
          if (thumbnailResult.success && thumbnailResult.url) {
            thumbnailUrl = thumbnailResult.url;
            log.info(`Thumbnail generated and uploaded: ${thumbnailUrl}`, this.logPrefix);
          }
        } catch (thumbnailError) {
          log.error(`Error generating thumbnail: ${(thumbnailError as Error).message}`, this.logPrefix);
          // Продолжаем выполнение даже если превью не сгенерировалось
        }
      }
      
      // Попытаемся получить метаданные видео из локального файла
      let metadata: VideoMetadata | undefined;
      try {
        metadata = await this.extractLocalVideoMetadata(filePath);
      } catch (metadataError) {
        log.error(`Error extracting video metadata: ${(metadataError as Error).message}`, this.logPrefix);
      }
      
      return {
        success: true,
        videoUrl: uploadResult.url,
        thumbnailUrl,
        metadata,
        key: uploadResult.key
      };
    } catch (error) {
      log.error(`Error uploading local video: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Генерирует и загружает превью для видео
   * @param videoUrl URL видео
   * @returns Результат загрузки превью
   */
  private async generateAndUploadThumbnail(videoUrl: string): Promise<UploadFileResult> {
    try {
      log.info(`Generating thumbnail for video: ${videoUrl}`, this.logPrefix);
      
      // Создаем временный файл для превью
      const tempDir = os.tmpdir();
      const thumbnailPath = path.join(tempDir, `thumbnail_${uuidv4()}.jpg`);
      
      // Используем ffmpeg для создания превью
      // Извлекаем кадр на 2й секунде или в середине видео, если не удается определить длительность
      const ffmpegCmd = `ffmpeg -y -i "${videoUrl}" -ss 00:00:02 -vframes 1 -qscale:v 2 "${thumbnailPath}" 2>/dev/null`;
      
      try {
        execSync(ffmpegCmd, { timeout: 30000 }); // 30 секунд таймаут
      } catch (ffmpegError) {
        // Если не удалось получить 2ю секунду, попробуем получить первый кадр
        const fallbackCmd = `ffmpeg -y -i "${videoUrl}" -vframes 1 -qscale:v 2 "${thumbnailPath}" 2>/dev/null`;
        execSync(fallbackCmd, { timeout: 30000 });
      }
      
      if (!fs.existsSync(thumbnailPath) || fs.statSync(thumbnailPath).size === 0) {
        throw new Error('Failed to generate thumbnail or thumbnail is empty');
      }
      
      // Загружаем превью в S3
      const uploadResult = await begetS3StorageAws.uploadLocalFile(
        thumbnailPath,
        undefined, // автоматическое имя файла
        'image/jpeg',
        this.thumbnailFolder
      );
      
      // Удаляем временный файл
      try {
        fs.unlinkSync(thumbnailPath);
      } catch (unlinkError) {
        log.error(`Error deleting temporary thumbnail file: ${(unlinkError as Error).message}`, this.logPrefix);
      }
      
      if (!uploadResult.success) {
        throw new Error(`Failed to upload thumbnail: ${uploadResult.error}`);
      }
      
      return uploadResult;
    } catch (error) {
      log.error(`Error generating and uploading thumbnail: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Извлекает метаданные из видео по URL
   * @param videoUrl URL видео
   * @returns Метаданные видео
   */
  private async extractVideoMetadata(videoUrl: string): Promise<VideoMetadata> {
    try {
      log.info(`Extracting metadata for video: ${videoUrl}`, this.logPrefix);
      
      // Используем ffprobe для получения метаданных
      const ffprobeCmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoUrl}"`;
      const output = execSync(ffprobeCmd, { timeout: 30000 }).toString();
      
      const metadata = JSON.parse(output);
      
      // Извлекаем нужные метаданные
      const videoStream = metadata.streams?.find((stream: any) => stream.codec_type === 'video');
      
      const result: VideoMetadata = {
        width: videoStream?.width,
        height: videoStream?.height,
        duration: metadata.format?.duration ? parseFloat(metadata.format.duration) : undefined,
        format: metadata.format?.format_name,
        size: metadata.format?.size ? parseInt(metadata.format.size) : undefined,
        bitrate: metadata.format?.bit_rate ? parseInt(metadata.format.bit_rate) : undefined,
        codec: videoStream?.codec_name
      };
      
      log.info(`Metadata extracted successfully: ${JSON.stringify(result)}`, this.logPrefix);
      return result;
    } catch (error) {
      log.error(`Error extracting video metadata: ${(error as Error).message}`, this.logPrefix);
      // Возвращаем пустой объект в случае ошибки
      return {};
    }
  }

  /**
   * Извлекает метаданные из локального видеофайла
   * @param filePath Путь к локальному видеофайлу
   * @returns Метаданные видео
   */
  private async extractLocalVideoMetadata(filePath: string): Promise<VideoMetadata> {
    try {
      log.info(`Extracting metadata for local video: ${filePath}`, this.logPrefix);
      
      // Используем ffprobe для получения метаданных
      const ffprobeCmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
      const output = execSync(ffprobeCmd, { timeout: 30000 }).toString();
      
      const metadata = JSON.parse(output);
      
      // Извлекаем нужные метаданные
      const videoStream = metadata.streams?.find((stream: any) => stream.codec_type === 'video');
      
      const result: VideoMetadata = {
        width: videoStream?.width,
        height: videoStream?.height,
        duration: metadata.format?.duration ? parseFloat(metadata.format.duration) : undefined,
        format: metadata.format?.format_name,
        size: metadata.format?.size ? parseInt(metadata.format.size) : undefined,
        bitrate: metadata.format?.bit_rate ? parseInt(metadata.format.bit_rate) : undefined,
        codec: videoStream?.codec_name
      };
      
      log.info(`Metadata extracted successfully: ${JSON.stringify(result)}`, this.logPrefix);
      return result;
    } catch (error) {
      log.error(`Error extracting local video metadata: ${(error as Error).message}`, this.logPrefix);
      // Возвращаем пустой объект в случае ошибки
      return {};
    }
  }
}

export interface UploadFileResult {
  success: boolean;
  key?: string;
  url?: string;
  error?: string;
}

// Экспортируем экземпляр сервиса для использования в приложении
export const begetS3VideoService = new BegetS3VideoService();