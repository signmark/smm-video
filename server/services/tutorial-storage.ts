/**
 * Сервис для работы с видео-инструкциями в S3 хранилище
 * Поддерживает presigned URLs для безопасной загрузки и просмотра
 */
import { 
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  PutBucketCorsCommand,
  GetBucketCorsCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { log } from '../utils/logger';

export interface TutorialStorageConfig {
  accessKey?: string;
  secretKey?: string; 
  endpoint?: string;
  region?: string;
  bucket?: string;
}

export interface PresignedUploadResult {
  success: boolean;
  key: string;
  uploadUrl: string;
  error?: string;
}

export interface PresignedDownloadResult {
  success: boolean;
  downloadUrl?: string;
  error?: string;
}

export class TutorialStorageService {
  private client: S3Client;
  private bucket: string;
  private logPrefix = 'tutorial-storage';

  constructor(config?: TutorialStorageConfig) {
    const accessKey = config?.accessKey || process.env.BEGET_S3_ACCESS_KEY;
    const secretKey = config?.secretKey || process.env.BEGET_S3_SECRET_KEY;
    const endpoint = config?.endpoint || process.env.BEGET_S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud';
    const region = config?.region || process.env.BEGET_S3_REGION || 'ru-1';
    this.bucket = config?.bucket || process.env.BEGET_S3_BUCKET || '';

    if (!accessKey || !secretKey) {
      throw new Error('S3 credentials not found in environment variables or config');
    }

    if (!this.bucket) {
      throw new Error('S3 bucket not specified');
    }

    this.client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey
      },
      forcePathStyle: true
    });

    log(`Tutorial Storage service initialized for bucket: ${this.bucket}`, this.logPrefix);
    
    // Настраиваем CORS для bucket при инициализации
    this.setupCORS().catch((error: Error) => {
      log(`Warning: Failed to setup CORS: ${error.message}`, this.logPrefix);
    });
  }

  /**
   * Настраивает CORS правила для bucket
   * Разрешает загрузку файлов из браузера
   */
  private async setupCORS(): Promise<void> {
    try {
      // Проверяем текущие CORS правила
      const getCurrentCORS = new GetBucketCorsCommand({
        Bucket: this.bucket
      });

      let existingCORS;
      try {
        const result = await this.client.send(getCurrentCORS);
        existingCORS = result.CORSRules;
      } catch (error) {
        // Если CORS правил нет, создаем новые
        log(`No existing CORS rules found, creating new ones`, this.logPrefix);
      }

      // Настройки CORS для загрузки видео-файлов
      const corsConfiguration = {
        CORSRules: [
          {
            ID: 'TutorialUploadRule',
            AllowedMethods: ['PUT', 'POST'], // Разрешаем загрузку
            AllowedOrigins: ['*'], // Разрешаем все домены (можно ограничить)
            AllowedHeaders: [
              'Content-Type',
              'Content-Length',
              'x-amz-checksum-crc32',
              'x-amz-meta-*'
            ],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600 // Кэширование CORS правил на 1 час
          },
          {
            ID: 'TutorialDownloadRule',
            AllowedMethods: ['GET', 'HEAD'], // Разрешаем просмотр
            AllowedOrigins: ['*'],
            AllowedHeaders: ['*'],
            MaxAgeSeconds: 3600
          }
        ]
      };

      // Применяем CORS правила
      const putCORSCommand = new PutBucketCorsCommand({
        Bucket: this.bucket,
        CORSConfiguration: corsConfiguration
      });

      await this.client.send(putCORSCommand);
      log(`CORS rules successfully configured for bucket: ${this.bucket}`, this.logPrefix);

    } catch (error) {
      log(`Error setting up CORS: ${(error as Error).message}`, this.logPrefix);
      throw error;
    }
  }

  /**
   * Генерирует presigned URL для загрузки видео
   * @param mimeType MIME тип файла (например: 'video/webm', 'video/mp4')
   * @param sizeBytes Размер файла в байтах (для валидации)
   * @param expirationMinutes Время жизни URL в минутах (по умолчанию 15)
   * @returns Presigned URL для загрузки и ключ файла
   */
  async generatePresignedUploadUrl(
    mimeType: string,
    sizeBytes: number,
    expirationMinutes: number = 15
  ): Promise<PresignedUploadResult> {
    try {
      // Валидация MIME типа
      if (!this.isValidVideoMimeType(mimeType)) {
        return {
          success: false,
          key: '',
          uploadUrl: '',
          error: 'Invalid video MIME type. Supported: video/webm, video/mp4'
        };
      }

      // Валидация размера (максимум 500MB)
      const maxSizeBytes = 500 * 1024 * 1024; // 500MB
      if (sizeBytes > maxSizeBytes) {
        return {
          success: false,
          key: '',
          uploadUrl: '',
          error: `File too large. Maximum size: ${maxSizeBytes / 1024 / 1024}MB`
        };
      }

      // Генерируем уникальный ключ: tutorials/{uuid}.{ext}
      const fileExtension = this.getFileExtension(mimeType);
      const fileKey = `tutorials/${uuidv4()}${fileExtension}`;

      // Создаем presigned PUT URL
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: fileKey,
        ContentType: mimeType,
        ContentLength: sizeBytes,
        // Метаданные для идентификации tutorial файлов
        Metadata: {
          'uploaded-by': 'tutorial-system',
          'content-type': 'video-tutorial',
          'upload-timestamp': Date.now().toString()
        }
      });

      const uploadUrl = await getSignedUrl(this.client, command, {
        expiresIn: expirationMinutes * 60 // секунды
      });

      log(`Generated presigned upload URL for tutorial: ${fileKey}`, this.logPrefix);
      
      return {
        success: true,
        key: fileKey,
        uploadUrl
      };
    } catch (error) {
      log(`Error generating presigned upload URL: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        key: '',
        uploadUrl: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Генерирует presigned URL для просмотра видео
   * @param fileKey Ключ файла в S3
   * @param expirationMinutes Время жизни URL в минутах (по умолчанию 60)
   * @returns Presigned URL для просмотра
   */
  async generatePresignedDownloadUrl(
    fileKey: string,
    expirationMinutes: number = 60
  ): Promise<PresignedDownloadResult> {
    try {
      // Проверяем что ключ начинается с tutorials/
      if (!fileKey.startsWith('tutorials/')) {
        return {
          success: false,
          error: 'Invalid file key. Must start with tutorials/'
        };
      }

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: fileKey
      });

      const downloadUrl = await getSignedUrl(this.client, command, {
        expiresIn: expirationMinutes * 60
      });

      log(`Generated presigned download URL for tutorial: ${fileKey}`, this.logPrefix);
      
      return {
        success: true,
        downloadUrl
      };
    } catch (error) {
      log(`Error generating presigned download URL: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Удаляет tutorial файл из S3
   * @param fileKey Ключ файла
   * @returns Результат удаления
   */
  async deleteTutorialFile(fileKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!fileKey.startsWith('tutorials/')) {
        return {
          success: false,
          error: 'Invalid file key. Must start with tutorials/'
        };
      }

      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: fileKey
      });

      await this.client.send(command);
      
      log(`Deleted tutorial file: ${fileKey}`, this.logPrefix);
      
      return { success: true };
    } catch (error) {
      log(`Error deleting tutorial file: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Проверяет валидность MIME типа для видео
   */
  private isValidVideoMimeType(mimeType: string): boolean {
    const validTypes = ['video/webm', 'video/mp4'];
    return validTypes.includes(mimeType);
  }

  /**
   * Получает расширение файла по MIME типу
   */
  private getFileExtension(mimeType: string): string {
    const extensions: Record<string, string> = {
      'video/webm': '.webm',
      'video/mp4': '.mp4'
    };
    return extensions[mimeType] || '.video';
  }
}

// Экспортируем singleton экземпляр
export const tutorialStorageService = new TutorialStorageService();