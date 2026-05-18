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
  async uploadVideoFromUrl(
    videoUrl: string,
    generateThumbnail: boolean = false
  ): Promise<UploadVideoResult> {
    try {
      log.info(`Uploading video from URL: ${videoUrl}`, this.logPrefix);
      
      // Скачиваем видео во временный файл
      const tempFilePath = await this.downloadVideoToTempFile(videoUrl);
      
      if (!tempFilePath) {
        throw new Error('Failed to download video to temp file');
      }
      
      log.info(`Video downloaded to temp file: ${tempFilePath}`, this.logPrefix);
      
      // Загружаем видео в Beget S3
      const result = await this.uploadVideoFile(tempFilePath, generateThumbnail);
      
      // Удаляем временный файл
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          log.info(`Deleted temp file: ${tempFilePath}`, this.logPrefix);
        }
      } catch (error) {
        log.error(`Error deleting temp file: ${(error as Error).message}`, this.logPrefix);
      }
      
      return result;
    } catch (error) {
      log.error(`Error uploading video from URL: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: `Error uploading video from URL: ${(error as Error).message}`
      };
    }
  }

  /**
   * Загружает локальный видеофайл в Beget S3
   * @param filePath Путь к локальному видеофайлу
   * @param generateThumbnail Флаг для генерации превью видео
   * @returns Результат загрузки видео
   */
  async uploadLocalVideo(
    filePath: string,
    generateThumbnail: boolean = false
  ): Promise<UploadVideoResult> {
    try {
      log.info(`Uploading local video: ${filePath}`, this.logPrefix);
      
      // Проверяем существование файла
      if (!fs.existsSync(filePath)) {
        throw new Error(`Video file not found: ${filePath}`);
      }
      
      // Загружаем видео в Beget S3
      return await this.uploadVideoFile(filePath, generateThumbnail);
    } catch (error) {
      log.error(`Error uploading local video: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: `Error uploading local video: ${(error as Error).message}`
      };
    }
  }

  /**
   * Загружает видеофайл в Beget S3
   * @param filePath Путь к видеофайлу
   * @param generateThumbnail Флаг для генерации превью видео
   * @returns Результат загрузки видео
   */
  private async uploadVideoFile(
    filePath: string,
    generateThumbnail: boolean = false
  ): Promise<UploadVideoResult> {
    try {
      // Получаем метаданные видео
      const metadata = await this.getVideoMetadata(filePath);
      
      // Генерируем уникальный ключ для видео
      const fileExt = path.extname(filePath);
      const videoKey = `${this.videoFolder}/${uuidv4()}${fileExt}`;
      
      log.info(`Uploading video to S3 with key: ${videoKey}`, this.logPrefix);
      const uploadResult = await begetS3StorageAws.uploadFile({
        key: videoKey,
        filePath,
        contentType: this.getContentTypeFromExtension(fileExt)
      });
      
      if (!uploadResult.success) {
        throw new Error(`Failed to upload video to S3: ${uploadResult.error}`);
      }
      
      log.info(`Video uploaded successfully: ${uploadResult.url}`, this.logPrefix);
      
      let thumbnailUrl = null;
      
      // Генерируем превью видео, если нужно
      if (generateThumbnail) {
        const thumbnailResult = await this.generateAndUploadThumbnail(filePath);
        if (thumbnailResult.success && thumbnailResult.url) {
          thumbnailUrl = thumbnailResult.url;
          log.info(`Thumbnail generated and uploaded: ${thumbnailUrl}`, this.logPrefix);
        } else {
          log.warn(`Failed to generate thumbnail: ${thumbnailResult.error}`, this.logPrefix);
        }
      }
      
      return {
        success: true,
        videoUrl: uploadResult.url,
        thumbnailUrl: thumbnailUrl || undefined,
        metadata,
        key: videoKey
      };
    } catch (error) {
      log.error(`Error in uploadVideoFile: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: `Error uploading video file: ${(error as Error).message}`
      };
    }
  }

  /**
   * Генерирует и загружает превью видео в Beget S3
   * @param videoPath Путь к видеофайлу
   * @returns Результат загрузки превью
   */
  private async generateAndUploadThumbnail(videoPath: string): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      // Создаем временный файл для превью
      const thumbnailPath = path.join(os.tmpdir(), `thumbnail_${uuidv4()}.jpg`);
      
      // Генерируем превью с помощью ffmpeg
      await this.generateThumbnail(videoPath, thumbnailPath);
      
      if (!fs.existsSync(thumbnailPath)) {
        throw new Error('Failed to generate thumbnail');
      }
      
      // Генерируем ключ для превью
      const thumbnailKey = `${this.thumbnailFolder}/${uuidv4()}.jpg`;
      
      log.info(`Uploading thumbnail to S3 with key: ${thumbnailKey}`, this.logPrefix);
      
      const uploadResult = await begetS3StorageAws.uploadFile({
        key: thumbnailKey,
        filePath: thumbnailPath,
        contentType: 'image/jpeg'
      });
      
      // Удаляем временный файл превью
      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
      }
      
      if (!uploadResult.success) {
        throw new Error(`Failed to upload thumbnail to S3: ${uploadResult.error}`);
      }
      
      return {
        success: true,
        url: uploadResult.url
      };
    } catch (error) {
      log.error(`Error generating and uploading thumbnail: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: `Error generating thumbnail: ${(error as Error).message}`
      };
    }
  }

  /**
   * Генерирует превью видео с помощью ffmpeg
   * @param videoPath Путь к видеофайлу
   * @param thumbnailPath Путь для сохранения превью
   */
  private async generateThumbnail(videoPath: string, thumbnailPath: string): Promise<void> {
    try {
      // Проверяем наличие ffmpeg
      this.checkFfmpegInstalled();
      
      // Получаем длительность видео для выбора средней точки
      const metadata = await this.getVideoMetadata(videoPath);
      const duration = metadata.duration || 0;
      
      // Выбираем точку для создания превью (30% от длительности видео или 3 секунды)
      const thumbnailTime = duration > 10 ? Math.floor(duration * 0.3) : 3;
      
      // Генерируем превью с помощью ffmpeg
      execSync(`ffmpeg -i "${videoPath}" -ss ${thumbnailTime} -vframes 1 -q:v 2 "${thumbnailPath}" -y`);
      
      log.info(`Thumbnail generated at ${thumbnailPath}`, this.logPrefix);
    } catch (error) {
      log.error(`Error generating thumbnail: ${(error as Error).message}`, this.logPrefix);
      throw new Error(`Failed to generate thumbnail: ${(error as Error).message}`);
    }
  }

  /**
   * Проверяет наличие ffmpeg в системе
   * @throws Error если ffmpeg не установлен
   */
  private checkFfmpegInstalled(): void {
    try {
      execSync('ffmpeg -version');
    } catch (error) {
      log.error('ffmpeg is not installed', this.logPrefix);
      throw new Error('ffmpeg is not installed or not in PATH');
    }
  }

  /**
   * Получает метаданные видео с помощью ffprobe
   * @param videoPath Путь к видеофайлу
   * @returns Метаданные видео
   */
  private async getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
    try {
      this.checkFfmpegInstalled(); // ffprobe обычно устанавливается вместе с ffmpeg
      
      const cmd = `ffprobe -v error -show_entries format=duration -show_entries stream=width,height,codec_name -show_entries format=bit_rate -of json "${videoPath}"`;
      const output = execSync(cmd).toString();
      
      const result = JSON.parse(output);
      
      const format = result.format || {};
      const streams = Array.isArray(result.streams) ? result.streams : [];
      const videoStream = streams.find((s: any) => s.codec_type === 'video' || s.width !== undefined) || {};
      
      // Размер файла в байтах
      const fileSizeInBytes = fs.statSync(videoPath).size;
      
      return {
        width: videoStream.width ? Number(videoStream.width) : undefined,
        height: videoStream.height ? Number(videoStream.height) : undefined,
        duration: format.duration ? Number(format.duration) : undefined,
        format: path.extname(videoPath).replace('.', ''),
        size: fileSizeInBytes,
        bitrate: format.bit_rate ? Number(format.bit_rate) : undefined,
        codec: videoStream.codec_name
      };
    } catch (error) {
      log.error(`Error getting video metadata: ${(error as Error).message}`, this.logPrefix);
      // Возвращаем пустой объект в случае ошибки
      return {};
    }
  }

  /**
   * Скачивает видео по URL во временный файл
   * @param url URL видео
   * @returns Путь к скачанному файлу или null в случае ошибки
   */
  private async downloadVideoToTempFile(url: string): Promise<string | null> {
    try {
      // Создаем временную директорию
      const tempDir = path.join(os.tmpdir(), 'beget-s3-video-downloads');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Определяем расширение файла из URL
      let fileExt = path.extname(url);
      if (!fileExt) {
        // Если расширение не определено, используем .mp4 по умолчанию
        fileExt = '.mp4';
      }
      
      // Создаем имя временного файла
      const tempFilePath = path.join(tempDir, `video_${uuidv4()}${fileExt}`);
      
      // Скачиваем видео с помощью curl или wget
      try {
        execSync(`curl -L "${url}" -o "${tempFilePath}"`);
      } catch (curlError) {
        log.warn(`Failed to download with curl: ${(curlError as Error).message}`, this.logPrefix);
        try {
          execSync(`wget "${url}" -O "${tempFilePath}"`);
        } catch (wgetError) {
          throw new Error('Failed to download video using both curl and wget');
        }
      }
      
      // Проверяем размер файла
      const fileSize = fs.statSync(tempFilePath).size;
      if (fileSize === 0) {
        fs.unlinkSync(tempFilePath);
        throw new Error('Downloaded file is empty');
      }
      
      return tempFilePath;
    } catch (error) {
      log.error(`Error downloading video to temp file: ${(error as Error).message}`, this.logPrefix);
      return null;
    }
  }

  /**
   * Получает MIME-тип на основе расширения файла
   * @param extension Расширение файла
   * @returns MIME-тип
   */
  private getContentTypeFromExtension(extension: string): string {
    const ext = extension.toLowerCase().replace('.', '');
    
    const mimeTypes: Record<string, string> = {
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
      'wmv': 'video/x-ms-wmv',
      'flv': 'video/x-flv',
      'mpg': 'video/mpeg',
      'mpeg': 'video/mpeg',
      'm4v': 'video/x-m4v',
      '3gp': 'video/3gpp'
    };
    
    return mimeTypes[ext] || 'video/mp4';
  }
}

export const begetS3VideoService = new BegetS3VideoService();