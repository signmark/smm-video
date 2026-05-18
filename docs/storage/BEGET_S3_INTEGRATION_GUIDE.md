# Инструкция по внедрению Beget S3 хранилища в проект

## 1. Настройка окружения

### Переменные окружения
Добавьте следующие переменные в файл `.env`:

```
BEGET_S3_ACCESS_KEY=ваш_ключ_доступа
BEGET_S3_SECRET_KEY=ваш_секретный_ключ
BEGET_S3_ENDPOINT=https://s3.ru1.storage.beget.cloud
BEGET_S3_REGION=ru-1
BEGET_S3_BUCKET=ваше_имя_бакета
```

## 2. Установка зависимостей

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

## 3. Создание сервиса для работы с S3

### Создайте файл `server/services/beget-s3-storage-aws.ts`

```typescript
/**
 * Сервис для работы с Beget S3 хранилищем через AWS SDK v3
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { log } from '../utils/logger';

export interface BegetS3StorageConfig {
  accessKey: string;
  secretKey: string;
  endpoint: string;
  region: string;
  bucket: string;
}

export interface UploadFileResult {
  success: boolean;
  key?: string;
  url?: string;
  error?: string;
}

export class BegetS3StorageAws {
  private client: S3Client;
  private bucket: string;
  private logPrefix = 'beget-s3-storage';

  constructor(config?: BegetS3StorageConfig) {
    const accessKey = config?.accessKey || process.env.BEGET_S3_ACCESS_KEY;
    const secretKey = config?.secretKey || process.env.BEGET_S3_SECRET_KEY;
    const endpoint = config?.endpoint || process.env.BEGET_S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud';
    const region = config?.region || process.env.BEGET_S3_REGION || 'ru-1';
    this.bucket = config?.bucket || process.env.BEGET_S3_BUCKET || '';

    if (!accessKey || !secretKey) {
      throw new Error('Beget S3 credentials not found in environment variables or config');
    }

    if (!this.bucket) {
      throw new Error('Beget S3 bucket not specified');
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

    log.info('Beget S3 Storage service initialized', this.logPrefix);
  }

  /**
   * Загружает файл в S3 хранилище
   * @param fileData Содержимое файла (Buffer или строка)
   * @param fileName Имя файла (опционально, если не указано - генерируется UUID)
   * @param contentType MIME-тип файла
   * @param folder Папка для сохранения (опционально)
   * @returns Результат загрузки файла
   */
  async uploadFile(
    fileData: Buffer | string, 
    fileName?: string, 
    contentType: string = 'application/octet-stream',
    folder?: string
  ): Promise<UploadFileResult> {
    try {
      const fileKey = this.generateFileKey(fileName, folder);
      
      log.info(`Uploading file to Beget S3: ${fileKey}`, this.logPrefix);
      
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: fileKey,
        Body: fileData,
        ContentType: contentType,
        ACL: 'public-read'
      });

      await this.client.send(command);
      
      const fileUrl = this.getPublicUrl(fileKey);
      log.info(`File uploaded successfully: ${fileUrl}`, this.logPrefix);
      
      return {
        success: true,
        key: fileKey,
        url: fileUrl
      };
    } catch (error) {
      log.error(`Error uploading file to Beget S3: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Загружает локальный файл в S3 хранилище
   * @param filePath Путь к локальному файлу
   * @param fileName Имя файла (опционально, если не указано - берется имя локального файла)
   * @param contentType MIME-тип файла (опционально, определяется по расширению)
   * @param folder Папка для сохранения (опционально)
   * @returns Результат загрузки файла
   */
  async uploadLocalFile(
    filePath: string, 
    fileName?: string, 
    contentType?: string,
    folder?: string
  ): Promise<UploadFileResult> {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const fileData = fs.readFileSync(filePath);
      const localFileName = fileName || path.basename(filePath);
      const mimeType = contentType || this.getMimeTypeByExtension(path.extname(filePath));

      return this.uploadFile(fileData, localFileName, mimeType, folder);
    } catch (error) {
      log.error(`Error uploading local file to Beget S3: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Загружает файл из URL в S3 хранилище
   * @param url URL файла для загрузки
   * @param fileName Имя файла (опционально, если не указано - генерируется UUID)
   * @param contentType MIME-тип файла (опционально)
   * @param folder Папка для сохранения (опционально)
   * @returns Результат загрузки файла
   */
  async uploadFromUrl(
    url: string, 
    fileName?: string, 
    contentType?: string,
    folder?: string
  ): Promise<UploadFileResult> {
    try {
      log.info(`Uploading file from URL: ${url}`, this.logPrefix);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch file from URL: ${response.status} ${response.statusText}`);
      }
      
      const fileData = await response.arrayBuffer();
      const buffer = Buffer.from(fileData);
      
      // Определяем тип контента
      const mimeType = contentType || response.headers.get('content-type') || 'application/octet-stream';
      
      // Если имя файла не указано, попробуем получить из URL
      const detectedFileName = fileName || this.extractFileNameFromUrl(url);
      
      return this.uploadFile(buffer, detectedFileName, mimeType, folder);
    } catch (error) {
      log.error(`Error uploading file from URL to Beget S3: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Получает файл из S3 хранилища
   * @param fileKey Ключ файла в S3
   * @returns Буфер с содержимым файла или null в случае ошибки
   */
  async getFile(fileKey: string): Promise<Buffer | null> {
    try {
      log.info(`Getting file from Beget S3: ${fileKey}`, this.logPrefix);
      
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: fileKey
      });

      const response = await this.client.send(command);
      
      if (!response.Body) {
        throw new Error('File body is empty');
      }
      
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('error', (err) => {
          log.error(`Error reading file stream: ${err.message}`, this.logPrefix);
          reject(err);
        });
        stream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          log.info(`File retrieved successfully, size: ${buffer.length} bytes`, this.logPrefix);
          resolve(buffer);
        });
      });
    } catch (error) {
      log.error(`Error getting file from Beget S3: ${(error as Error).message}`, this.logPrefix);
      return null;
    }
  }

  /**
   * Получает временную ссылку на файл (с ограниченным сроком действия)
   * @param fileKey Ключ файла в S3
   * @param expirationSeconds Срок действия ссылки в секундах (по умолчанию 3600 = 1 час)
   * @returns Временная ссылка на файл или null в случае ошибки
   */
  async getSignedUrl(fileKey: string, expirationSeconds: number = 3600): Promise<string | null> {
    try {
      log.info(`Getting signed URL for file: ${fileKey}`, this.logPrefix);
      
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: fileKey
      });

      const signedUrl = await getSignedUrl(this.client, command, {
        expiresIn: expirationSeconds
      });
      
      log.info(`Signed URL generated successfully`, this.logPrefix);
      return signedUrl;
    } catch (error) {
      log.error(`Error getting signed URL: ${(error as Error).message}`, this.logPrefix);
      return null;
    }
  }

  /**
   * Удаляет файл из S3 хранилища
   * @param fileKey Ключ файла в S3
   * @returns true в случае успеха, false в случае ошибки
   */
  async deleteFile(fileKey: string): Promise<boolean> {
    try {
      log.info(`Deleting file from Beget S3: ${fileKey}`, this.logPrefix);
      
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: fileKey
      });

      await this.client.send(command);
      
      log.info(`File deleted successfully`, this.logPrefix);
      return true;
    } catch (error) {
      log.error(`Error deleting file from Beget S3: ${(error as Error).message}`, this.logPrefix);
      return false;
    }
  }

  /**
   * Проверяет существование файла в S3 хранилище
   * @param fileKey Ключ файла в S3
   * @returns true если файл существует, false если файл не существует или произошла ошибка
   */
  async fileExists(fileKey: string): Promise<boolean> {
    try {
      log.info(`Checking if file exists in Beget S3: ${fileKey}`, this.logPrefix);
      
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: fileKey
      });

      await this.client.send(command);
      
      log.info(`File exists: ${fileKey}`, this.logPrefix);
      return true;
    } catch (error) {
      log.info(`File does not exist or error occurred: ${fileKey}`, this.logPrefix);
      return false;
    }
  }

  /**
   * Получает список файлов в папке
   * @param folder Папка для просмотра (опционально)
   * @param maxKeys Максимальное количество файлов для получения (по умолчанию 1000)
   * @returns Массив ключей файлов или пустой массив в случае ошибки
   */
  async listFiles(folder?: string, maxKeys: number = 1000): Promise<string[]> {
    try {
      const prefix = folder ? `${folder}/` : '';
      
      log.info(`Listing files in Beget S3 bucket: ${this.bucket}, prefix: ${prefix || 'root'}`, this.logPrefix);
      
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys
      });

      const response = await this.client.send(command);
      
      const files = response.Contents?.map(item => item.Key as string) || [];
      
      log.info(`Retrieved ${files.length} files`, this.logPrefix);
      return files;
    } catch (error) {
      log.error(`Error listing files in Beget S3: ${(error as Error).message}`, this.logPrefix);
      return [];
    }
  }

  /**
   * Получает публичный URL файла
   * @param fileKey Ключ файла в S3
   * @returns Публичный URL файла
   */
  getPublicUrl(fileKey: string): string {
    const baseEndpoint = process.env.BEGET_S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud';
    const endpoint = baseEndpoint.replace('https://', '');
    return `https://${this.bucket}.${endpoint}/${fileKey}`;
  }

  /**
   * Генерирует ключ файла в S3
   * @param fileName Имя файла (опционально)
   * @param folder Папка (опционально)
   * @returns Ключ файла
   */
  private generateFileKey(fileName?: string, folder?: string): string {
    const actualFileName = fileName || `${uuidv4()}${this.getRandomExtension()}`;
    const sanitizedFileName = this.sanitizeFileName(actualFileName);
    
    if (folder) {
      return `${folder}/${sanitizedFileName}`;
    }
    
    return sanitizedFileName;
  }

  /**
   * Очищает имя файла от недопустимых символов
   * @param fileName Имя файла
   * @returns Очищенное имя файла
   */
  private sanitizeFileName(fileName: string): string {
    // Заменяем пробелы и специальные символы
    return fileName
      .replace(/\s+/g, '_')
      .replace(/[^\w\-\.]/g, '_');
  }

  /**
   * Определяет MIME-тип по расширению файла
   * @param extension Расширение файла (с точкой, например ".jpg")
   * @returns MIME-тип
   */
  private getMimeTypeByExtension(extension: string): string {
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.webm': 'video/webm',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.zip': 'application/zip',
      '.json': 'application/json',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript'
    };

    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }

  /**
   * Получает случайное расширение файла для UUID
   * @returns Расширение файла
   */
  private getRandomExtension(): string {
    const extensions = ['.bin', '.file', '.data', '.tmp'];
    return extensions[Math.floor(Math.random() * extensions.length)];
  }

  /**
   * Извлекает имя файла из URL
   * @param url URL файла
   * @returns Имя файла или пустую строку
   */
  private extractFileNameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const fileName = pathname.split('/').pop() || '';
      
      // Если имя файла содержит параметры запроса, удаляем их
      return fileName.split('?')[0];
    } catch (error) {
      // Если не удалось разобрать URL, возвращаем пустую строку
      return '';
    }
  }
}

// Экспортируем экземпляр сервиса для использования в приложении
export const begetS3StorageAws = new BegetS3StorageAws();
```

## 4. Создание специализированного сервиса для видео

### Создайте файл `server/services/beget-s3-video-service.ts`

```typescript
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
      
      // Генерируем превью, если требуется
      if (generateThumbnail) {
        try {
          const thumbnailResult = await this.generateThumbnailFromUrl(videoUrl, uploadResult.key);
          if (thumbnailResult.success && thumbnailResult.url) {
            thumbnailUrl = thumbnailResult.url;
            log.info(`Generated thumbnail: ${thumbnailUrl}`, this.logPrefix);
          }
        } catch (thumbnailError) {
          log.error(`Error generating thumbnail: ${(thumbnailError as Error).message}`, this.logPrefix);
          // Продолжаем выполнение даже если превью не сгенерировалось
        }
      }

      // Получаем метаданные видео
      const metadata = await this.extractMetadataFromUrl(videoUrl);

      return {
        success: true,
        videoUrl: uploadResult.url,
        thumbnailUrl,
        metadata,
        key: uploadResult.key
      };
    } catch (error) {
      log.error(`Error uploading video: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Загружает локальный видеофайл в Beget S3
   * @param filePath Путь к локальному файлу
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
      const fileName = path.basename(filePath);
      const uploadResult = await begetS3StorageAws.uploadLocalFile(
        filePath,
        fileName,
        this.getMimeTypeByExtension(path.extname(filePath)),
        this.videoFolder
      );

      if (!uploadResult.success) {
        throw new Error(`Failed to upload video: ${uploadResult.error}`);
      }

      log.info(`Video uploaded successfully: ${uploadResult.url}`, this.logPrefix);
      
      let thumbnailUrl: string | undefined;
      
      // Генерируем превью, если требуется
      if (generateThumbnail) {
        try {
          const thumbnailResult = await this.generateThumbnailFromLocal(filePath, uploadResult.key);
          if (thumbnailResult.success && thumbnailResult.url) {
            thumbnailUrl = thumbnailResult.url;
            log.info(`Generated thumbnail: ${thumbnailUrl}`, this.logPrefix);
          }
        } catch (thumbnailError) {
          log.error(`Error generating thumbnail: ${(thumbnailError as Error).message}`, this.logPrefix);
          // Продолжаем выполнение даже если превью не сгенерировалось
        }
      }

      // Получаем метаданные видео
      const metadata = await this.extractMetadataFromLocal(filePath);

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
   * Генерирует превью для видео из URL
   * @param videoUrl URL видео
   * @param videoKey Ключ исходного видео в S3 (для именования)
   * @returns Результат создания превью
   */
  private async generateThumbnailFromUrl(videoUrl: string, videoKey?: string): Promise<{success: boolean; url?: string; error?: string}> {
    try {
      log.info(`Generating thumbnail for video URL: ${videoUrl}`, this.logPrefix);
      
      // Создаем временный файл для скачивания видео
      const tempDir = os.tmpdir();
      const tempVideoPath = path.join(tempDir, `temp_video_${uuidv4()}${this.getExtensionFromUrl(videoUrl)}`);
      const tempThumbnailPath = path.join(tempDir, `temp_thumbnail_${uuidv4()}.jpg`);
      
      try {
        // Скачиваем видео
        const response = await fetch(videoUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
        }
        
        const videoBuffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(tempVideoPath, videoBuffer);
        
        // Генерируем превью с помощью FFmpeg
        this.generateThumbnailWithFFmpeg(tempVideoPath, tempThumbnailPath);
        
        if (!fs.existsSync(tempThumbnailPath)) {
          throw new Error('Failed to generate thumbnail');
        }
        
        // Формируем имя превью на основе ключа видео
        let thumbnailName: string;
        if (videoKey) {
          const baseName = path.basename(videoKey, path.extname(videoKey));
          thumbnailName = `${baseName}_thumbnail.jpg`;
        } else {
          thumbnailName = `thumbnail_${uuidv4()}.jpg`;
        }
        
        // Загружаем превью в S3
        const uploadResult = await begetS3StorageAws.uploadLocalFile(
          tempThumbnailPath,
          thumbnailName,
          'image/jpeg',
          this.thumbnailFolder
        );
        
        if (!uploadResult.success) {
          throw new Error(`Failed to upload thumbnail: ${uploadResult.error}`);
        }
        
        return {
          success: true,
          url: uploadResult.url
        };
      } finally {
        // Удаляем временные файлы
        this.safeDeleteFile(tempVideoPath);
        this.safeDeleteFile(tempThumbnailPath);
      }
    } catch (error) {
      log.error(`Error generating thumbnail from URL: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Генерирует превью для локального видеофайла
   * @param videoPath Путь к локальному видеофайлу
   * @param videoKey Ключ исходного видео в S3 (для именования)
   * @returns Результат создания превью
   */
  private async generateThumbnailFromLocal(videoPath: string, videoKey?: string): Promise<{success: boolean; url?: string; error?: string}> {
    try {
      log.info(`Generating thumbnail for local video: ${videoPath}`, this.logPrefix);
      
      // Создаем временный файл для превью
      const tempDir = os.tmpdir();
      const tempThumbnailPath = path.join(tempDir, `temp_thumbnail_${uuidv4()}.jpg`);
      
      try {
        // Генерируем превью с помощью FFmpeg
        this.generateThumbnailWithFFmpeg(videoPath, tempThumbnailPath);
        
        if (!fs.existsSync(tempThumbnailPath)) {
          throw new Error('Failed to generate thumbnail');
        }
        
        // Формируем имя превью на основе ключа видео
        let thumbnailName: string;
        if (videoKey) {
          const baseName = path.basename(videoKey, path.extname(videoKey));
          thumbnailName = `${baseName}_thumbnail.jpg`;
        } else {
          const videoBaseName = path.basename(videoPath, path.extname(videoPath));
          thumbnailName = `${videoBaseName}_thumbnail.jpg`;
        }
        
        // Загружаем превью в S3
        const uploadResult = await begetS3StorageAws.uploadLocalFile(
          tempThumbnailPath,
          thumbnailName,
          'image/jpeg',
          this.thumbnailFolder
        );
        
        if (!uploadResult.success) {
          throw new Error(`Failed to upload thumbnail: ${uploadResult.error}`);
        }
        
        return {
          success: true,
          url: uploadResult.url
        };
      } finally {
        // Удаляем временный файл превью
        this.safeDeleteFile(tempThumbnailPath);
      }
    } catch (error) {
      log.error(`Error generating thumbnail from local file: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Извлекает метаданные из URL видео
   * @param videoUrl URL видео
   * @returns Метаданные видео
   */
  private async extractMetadataFromUrl(videoUrl: string): Promise<VideoMetadata> {
    try {
      log.info(`Extracting metadata from video URL: ${videoUrl}`, this.logPrefix);
      
      // Создаем временный файл для скачивания видео
      const tempDir = os.tmpdir();
      const tempVideoPath = path.join(tempDir, `temp_video_${uuidv4()}${this.getExtensionFromUrl(videoUrl)}`);
      
      try {
        // Скачиваем видео
        const response = await fetch(videoUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
        }
        
        const videoBuffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(tempVideoPath, videoBuffer);
        
        // Извлекаем метаданные с помощью FFmpeg
        return this.extractMetadataWithFFmpeg(tempVideoPath);
      } finally {
        // Удаляем временный файл
        this.safeDeleteFile(tempVideoPath);
      }
    } catch (error) {
      log.error(`Error extracting metadata from URL: ${(error as Error).message}`, this.logPrefix);
      return {};
    }
  }

  /**
   * Извлекает метаданные из локального видеофайла
   * @param videoPath Путь к локальному видеофайлу
   * @returns Метаданные видео
   */
  private async extractMetadataFromLocal(videoPath: string): Promise<VideoMetadata> {
    try {
      log.info(`Extracting metadata from local video: ${videoPath}`, this.logPrefix);
      
      // Извлекаем метаданные с помощью FFmpeg
      return this.extractMetadataWithFFmpeg(videoPath);
    } catch (error) {
      log.error(`Error extracting metadata from local file: ${(error as Error).message}`, this.logPrefix);
      return {};
    }
  }

  /**
   * Генерирует превью видео с помощью FFmpeg
   * @param videoPath Путь к видеофайлу
   * @param outputPath Путь для сохранения превью
   */
  private generateThumbnailWithFFmpeg(videoPath: string, outputPath: string): void {
    try {
      log.info(`Using FFmpeg to generate thumbnail: ${videoPath} -> ${outputPath}`, this.logPrefix);
      
      // Команда FFmpeg для создания превью из середины видео
      const command = `ffmpeg -i "${videoPath}" -ss 00:00:03 -frames:v 1 -q:v 2 "${outputPath}" -y`;
      execSync(command, { stdio: 'ignore' });
      
      if (!fs.existsSync(outputPath)) {
        throw new Error('Failed to generate thumbnail with FFmpeg');
      }
    } catch (error) {
      throw new Error(`FFmpeg error: ${(error as Error).message}`);
    }
  }

  /**
   * Извлекает метаданные видео с помощью FFmpeg
   * @param videoPath Путь к видеофайлу
   * @returns Метаданные видео
   */
  private extractMetadataWithFFmpeg(videoPath: string): VideoMetadata {
    try {
      log.info(`Using FFmpeg to extract metadata: ${videoPath}`, this.logPrefix);
      
      // Команда FFmpeg для получения информации о видео в формате JSON
      const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`;
      const output = execSync(command, { encoding: 'utf-8' });
      
      const data = JSON.parse(output);
      const metadata: VideoMetadata = {};
      
      // Ищем видеопоток
      const videoStream = data.streams?.find((stream: any) => stream.codec_type === 'video');
      
      if (videoStream) {
        metadata.width = videoStream.width;
        metadata.height = videoStream.height;
        metadata.codec = videoStream.codec_name;
      }
      
      // Информация о формате
      if (data.format) {
        metadata.format = data.format.format_name;
        metadata.duration = parseFloat(data.format.duration);
        metadata.size = parseInt(data.format.size, 10);
        metadata.bitrate = parseInt(data.format.bit_rate, 10);
      }
      
      return metadata;
    } catch (error) {
      log.error(`FFmpeg metadata extraction error: ${(error as Error).message}`, this.logPrefix);
      return {};
    }
  }

  /**
   * Безопасно удаляет файл, игнорируя ошибки
   * @param filePath Путь к файлу
   */
  private safeDeleteFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      log.error(`Error deleting temporary file ${filePath}: ${(error as Error).message}`, this.logPrefix);
    }
  }

  /**
   * Получает расширение файла из URL
   * @param url URL файла
   * @returns Расширение файла (с точкой)
   */
  private getExtensionFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const fileName = pathname.split('/').pop() || '';
      
      // Получаем расширение
      const ext = path.extname(fileName.split('?')[0]);
      
      // Если расширение не найдено, возвращаем .mp4 по умолчанию
      return ext || '.mp4';
    } catch (error) {
      return '.mp4'; // По умолчанию
    }
  }

  /**
   * Определяет MIME-тип по расширению видеофайла
   * @param extension Расширение файла (с точкой)
   * @returns MIME-тип
   */
  private getMimeTypeByExtension(extension: string): string {
    const videoMimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.ogg': 'video/ogg',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.mkv': 'video/x-matroska',
      '.3gp': 'video/3gpp',
      '.m4v': 'video/x-m4v',
      '.ts': 'video/mp2t'
    };

    return videoMimeTypes[extension.toLowerCase()] || 'video/mp4';
  }
}

// Экспортируем экземпляр сервиса для использования в приложении
export const begetS3VideoService = new BegetS3VideoService();
```

## 5. Создание API маршрутов для S3

### Создайте файл `server/routes/beget-s3-aws.ts`

```typescript
/**
 * Маршруты для работы с Beget S3 хранилищем
 */
import { Router } from 'express';
import multer from 'multer';
import { begetS3StorageAws } from '../services/beget-s3-storage-aws';
import { log } from '../utils/logger';

// Настраиваем multer для временного хранения файлов в памяти
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB максимальный размер файла
  }
});

const router = Router();
const logPrefix = 'beget-s3-routes';

/**
 * @route POST /api/s3/upload
 * @desc Загружает файл в Beget S3 хранилище
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }
    
    log.info(`Received file upload request: ${req.file.originalname}`, logPrefix);
    
    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;
    const contentType = req.file.mimetype;
    const folder = req.body.folder || undefined;
    
    const result = await begetS3StorageAws.uploadFile(
      fileBuffer,
      fileName,
      contentType,
      folder
    );
    
    if (result.success) {
      log.info(`File uploaded successfully: ${result.url}`, logPrefix);
      return res.status(200).json(result);
    } else {
      log.error(`Error uploading file: ${result.error}`, logPrefix);
      return res.status(500).json(result);
    }
  } catch (error) {
    log.error(`Exception in file upload: ${(error as Error).message}`, logPrefix);
    return res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: (error as Error).message
    });
  }
});

/**
 * @route POST /api/s3/upload-from-url
 * @desc Загружает файл из URL в Beget S3 хранилище
 */
router.post('/upload-from-url', async (req, res) => {
  try {
    const { url, fileName, contentType, folder } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL is required'
      });
    }
    
    log.info(`Received upload from URL request: ${url}`, logPrefix);
    
    const result = await begetS3StorageAws.uploadFromUrl(
      url,
      fileName,
      contentType,
      folder
    );
    
    if (result.success) {
      log.info(`File uploaded from URL successfully: ${result.url}`, logPrefix);
      return res.status(200).json(result);
    } else {
      log.error(`Error uploading file from URL: ${result.error}`, logPrefix);
      return res.status(500).json(result);
    }
  } catch (error) {
    log.error(`Exception in upload from URL: ${(error as Error).message}`, logPrefix);
    return res.status(500).json({
      success: false,
      message: 'Error uploading file from URL',
      error: (error as Error).message
    });
  }
});

/**
 * @route GET /api/s3/list
 * @desc Получает список файлов из папки в Beget S3 хранилище
 */
router.get('/list', async (req, res) => {
  try {
    const folder = req.query.folder as string | undefined;
    const maxKeys = req.query.maxKeys ? parseInt(req.query.maxKeys as string) : 1000;
    
    log.info(`Received list files request: ${folder || 'root'}`, logPrefix);
    
    const files = await begetS3StorageAws.listFiles(folder, maxKeys);
    
    return res.status(200).json({
      success: true,
      files,
      count: files.length
    });
  } catch (error) {
    log.error(`Exception in list files: ${(error as Error).message}`, logPrefix);
    return res.status(500).json({
      success: false,
      message: 'Error listing files',
      error: (error as Error).message
    });
  }
});

/**
 * @route DELETE /api/s3/delete
 * @desc Удаляет файл из Beget S3 хранилища
 */
router.delete('/delete', async (req, res) => {
  try {
    const { key } = req.body;
    
    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'File key is required'
      });
    }
    
    log.info(`Received delete file request: ${key}`, logPrefix);
    
    const result = await begetS3StorageAws.deleteFile(key);
    
    return res.status(200).json({
      success: result,
      message: result ? 'File deleted successfully' : 'Failed to delete file'
    });
  } catch (error) {
    log.error(`Exception in delete file: ${(error as Error).message}`, logPrefix);
    return res.status(500).json({
      success: false,
      message: 'Error deleting file',
      error: (error as Error).message
    });
  }
});

/**
 * @route GET /api/s3/signed-url
 * @desc Получает временную ссылку на файл
 */
router.get('/signed-url', async (req, res) => {
  try {
    const key = req.query.key as string;
    const expires = req.query.expires ? parseInt(req.query.expires as string) : 3600;
    
    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'File key is required'
      });
    }
    
    log.info(`Received signed URL request: ${key}`, logPrefix);
    
    const signedUrl = await begetS3StorageAws.getSignedUrl(key, expires);
    
    if (signedUrl) {
      return res.status(200).json({
        success: true,
        url: signedUrl,
        expires
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'Could not generate signed URL'
      });
    }
  } catch (error) {
    log.error(`Exception in signed URL: ${(error as Error).message}`, logPrefix);
    return res.status(500).json({
      success: false,
      message: 'Error generating signed URL',
      error: (error as Error).message
    });
  }
});

export default router;
```

### Создайте файл `server/routes/beget-s3-video.ts`

```typescript
/**
 * Маршруты для работы с видео через Beget S3
 */
import { Router } from 'express';
import multer from 'multer';
import { begetS3VideoService } from '../services/beget-s3-video-service';
import { log } from '../utils/logger';

// Настраиваем multer для временного хранения файлов в памяти
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB максимальный размер видеофайла
  },
  fileFilter: (req, file, cb) => {
    // Проверяем, что файл - видео
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(null, false);
      return cb(new Error('Only video files are allowed'));
    }
  }
});

const router = Router();
const logPrefix = 'beget-s3-video-routes';

/**
 * @route POST /api/s3/video/upload
 * @desc Загружает видеофайл в Beget S3 хранилище
 */
router.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No video file provided'
      });
    }
    
    log.info(`Received video upload request: ${req.file.originalname}`, logPrefix);
    
    // Создаем временный файл для обработки
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const { v4: uuidv4 } = require('uuid');
    
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `upload_${uuidv4()}_${req.file.originalname}`);
    
    try {
      // Записываем буфер во временный файл
      fs.writeFileSync(tempFilePath, req.file.buffer);
      
      // Получаем параметр generateThumbnail из запроса
      const generateThumbnail = req.body.generateThumbnail !== 'false';
      
      // Загружаем видео в S3
      const result = await begetS3VideoService.uploadLocalVideo(tempFilePath, generateThumbnail);
      
      if (result.success) {
        log.info(`Video uploaded successfully: ${result.videoUrl}`, logPrefix);
        return res.status(200).json(result);
      } else {
        log.error(`Error uploading video: ${result.error}`, logPrefix);
        return res.status(500).json(result);
      }
    } finally {
      // Удаляем временный файл
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (err) {
        log.error(`Error deleting temporary file: ${(err as Error).message}`, logPrefix);
      }
    }
  } catch (error) {
    log.error(`Exception in video upload: ${(error as Error).message}`, logPrefix);
    return res.status(500).json({
      success: false,
      message: 'Error uploading video',
      error: (error as Error).message
    });
  }
});

/**
 * @route POST /api/s3/video/upload-from-url
 * @desc Загружает видео из URL в Beget S3 хранилище
 */
router.post('/upload-from-url', async (req, res) => {
  try {
    const { url, generateThumbnail = true } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'Video URL is required'
      });
    }
    
    log.info(`Received video upload from URL request: ${url}`, logPrefix);
    
    const result = await begetS3VideoService.uploadVideoFromUrl(url, generateThumbnail);
    
    if (result.success) {
      log.info(`Video uploaded from URL successfully: ${result.videoUrl}`, logPrefix);
      return res.status(200).json(result);
    } else {
      log.error(`Error uploading video from URL: ${result.error}`, logPrefix);
      return res.status(500).json(result);
    }
  } catch (error) {
    log.error(`Exception in video upload from URL: ${(error as Error).message}`, logPrefix);
    return res.status(500).json({
      success: false,
      message: 'Error uploading video from URL',
      error: (error as Error).message
    });
  }
});

export default router;
```

## 6. Регистрация маршрутов

### Обновите файл `server/index.ts`

Добавьте импорт и регистрацию маршрутов:

```typescript
// Импорт маршрутов Beget S3
import begetS3Routes from './routes/beget-s3-aws';
import begetS3VideoRoutes from './routes/beget-s3-video';

// Регистрация маршрутов
app.use('/api/s3', begetS3Routes);
app.use('/api/s3/video', begetS3VideoRoutes);
```

## 7. Интеграция с сервисом Telegram для работы с видео

### Создайте файл `server/services/social/telegram-s3-integration.ts`

```typescript
/**
 * Интеграция Beget S3 с Telegram для работы с видео
 */
import { log } from '../../utils/logger';
import { begetS3StorageAws } from '../beget-s3-storage-aws';
import { begetS3VideoService } from '../beget-s3-video-service';
import axios from 'axios';

export interface TelegramVideoResult {
  success: boolean;
  messageId?: number;
  url?: string;
  error?: string;
}

export class TelegramS3Integration {
  private logPrefix = 'telegram-s3';

  /**
   * Отправляет видео в Telegram из S3 хранилища или внешнего URL
   * @param chatId ID чата Telegram
   * @param token Токен бота Telegram
   * @param videoUrl URL видео (из S3 или внешний)
   * @param caption Подпись к видео
   * @param replyToMessageId ID сообщения, на которое нужно ответить
   * @returns Результат отправки видео
   */
  async sendVideoToTelegram(
    chatId: string,
    token: string,
    videoUrl: string,
    caption: string = '',
    replyToMessageId?: number
  ): Promise<TelegramVideoResult> {
    try {
      log.info(`Sending video to Telegram: ${videoUrl}`, this.logPrefix);
      
      // Форматируем chatId для использования в API
      const formattedChatId = this.formatTelegramChatId(chatId);
      
      // Смотрим, это URL из нашего S3 или внешний URL
      const isBegetS3Url = this.isBegetS3Url(videoUrl);
      
      if (isBegetS3Url) {
        // Если это видео из нашего S3, отправляем напрямую по URL
        return this.sendVideoByUrl(formattedChatId, token, videoUrl, caption, replyToMessageId);
      } else {
        // Если это внешнее видео, сначала загружаем его в наш S3
        log.info('External video URL detected, uploading to Beget S3 first', this.logPrefix);
        
        const uploadResult = await begetS3VideoService.uploadVideoFromUrl(videoUrl, false);
        
        if (!uploadResult.success || !uploadResult.videoUrl) {
          throw new Error(`Failed to upload video to Beget S3: ${uploadResult.error}`);
        }
        
        log.info(`Video successfully uploaded to S3: ${uploadResult.videoUrl}`, this.logPrefix);
        
        // Теперь отправляем загруженное в S3 видео
        return this.sendVideoByUrl(formattedChatId, token, uploadResult.videoUrl, caption, replyToMessageId);
      }
    } catch (error) {
      log.error(`Error sending video to Telegram: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Отправляет видео в Telegram по URL
   * @param chatId ID чата Telegram
   * @param token Токен бота Telegram
   * @param videoUrl URL видео
   * @param caption Подпись к видео
   * @param replyToMessageId ID сообщения, на которое нужно ответить
   * @returns Результат отправки видео
   */
  private async sendVideoByUrl(
    chatId: string,
    token: string,
    videoUrl: string,
    caption: string = '',
    replyToMessageId?: number
  ): Promise<TelegramVideoResult> {
    try {
      log.info(`Sending video by URL to Telegram chat ${chatId}`, this.logPrefix);
      
      const apiUrl = `https://api.telegram.org/bot${token}/sendVideo`;
      
      // Подготавливаем параметры запроса
      const params: Record<string, any> = {
        chat_id: chatId,
        video: videoUrl,
        caption: caption || '',
        parse_mode: 'HTML',
        supports_streaming: true
      };
      
      // Добавляем reply_to_message_id, если указан
      if (replyToMessageId) {
        params.reply_to_message_id = replyToMessageId;
      }
      
      // Отправляем запрос к API Telegram
      const response = await axios.post(apiUrl, params);
      
      if (response.data && response.data.ok) {
        const messageId = response.data.result.message_id;
        log.info(`Video successfully sent to Telegram, message ID: ${messageId}`, this.logPrefix);
        
        // Формируем URL сообщения
        const messageUrl = this.formatTelegramMessageUrl(chatId, messageId);
        
        return {
          success: true,
          messageId,
          url: messageUrl
        };
      } else {
        throw new Error(`Telegram API error: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      log.error(`Error sending video by URL: ${(error as Error).message}`, this.logPrefix);
      
      // Если ошибка связана с ограничением размера, попробуем скачать видео
      // и отправить как файл multipart/form-data
      if ((error as any)?.response?.data?.description?.includes('file is too big')) {
        log.info('Video file is too big for direct URL send, trying multipart upload', this.logPrefix);
        return this.sendVideoByMultipart(chatId, token, videoUrl, caption, replyToMessageId);
      }
      
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Отправляет видео в Telegram через multipart/form-data
   * @param chatId ID чата Telegram
   * @param token Токен бота Telegram
   * @param videoUrl URL видео
   * @param caption Подпись к видео
   * @param replyToMessageId ID сообщения, на которое нужно ответить
   * @returns Результат отправки видео
   */
  private async sendVideoByMultipart(
    chatId: string,
    token: string,
    videoUrl: string,
    caption: string = '',
    replyToMessageId?: number
  ): Promise<TelegramVideoResult> {
    try {
      log.info(`Sending video by multipart to Telegram chat ${chatId}`, this.logPrefix);
      
      // Скачиваем видео во временный буфер
      const videoBuffer = await this.downloadVideo(videoUrl);
      
      if (!videoBuffer) {
        throw new Error('Failed to download video');
      }
      
      const apiUrl = `https://api.telegram.org/bot${token}/sendVideo`;
      
      // Создаем FormData
      const FormData = require('form-data');
      const form = new FormData();
      
      form.append('chat_id', chatId);
      form.append('caption', caption || '');
      form.append('parse_mode', 'HTML');
      form.append('supports_streaming', 'true');
      
      // Добавляем reply_to_message_id, если указан
      if (replyToMessageId) {
        form.append('reply_to_message_id', replyToMessageId);
      }
      
      // Добавляем видео как буфер
      const fileName = this.extractFileNameFromUrl(videoUrl) || 'video.mp4';
      form.append('video', videoBuffer, { filename: fileName });
      
      // Отправляем запрос к API Telegram
      const response = await axios.post(apiUrl, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
      
      if (response.data && response.data.ok) {
        const messageId = response.data.result.message_id;
        log.info(`Video successfully sent to Telegram via multipart, message ID: ${messageId}`, this.logPrefix);
        
        // Формируем URL сообщения
        const messageUrl = this.formatTelegramMessageUrl(chatId, messageId);
        
        return {
          success: true,
          messageId,
          url: messageUrl
        };
      } else {
        throw new Error(`Telegram API error: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      log.error(`Error sending video by multipart: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Скачивает видео во временный буфер
   * @param url URL видео
   * @returns Буфер с видео или null в случае ошибки
   */
  private async downloadVideo(url: string): Promise<Buffer | null> {
    try {
      log.info(`Downloading video from URL: ${url}`, this.logPrefix);
      
      // Если это URL из нашего S3, используем наш сервис
      if (this.isBegetS3Url(url)) {
        const fileKey = this.extractKeyFromBegetS3Url(url);
        if (!fileKey) {
          throw new Error('Could not extract file key from S3 URL');
        }
        
        return await begetS3StorageAws.getFile(fileKey);
      }
      
      // Если это внешний URL, скачиваем через fetch
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      log.error(`Error downloading video: ${(error as Error).message}`, this.logPrefix);
      return null;
    }
  }

  /**
   * Извлекает имя файла из URL
   * @param url URL файла
   * @returns Имя файла или null
   */
  private extractFileNameFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const fileName = pathParts[pathParts.length - 1];
      
      // Удаляем параметры запроса, если они есть
      return fileName.split('?')[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Извлекает ключ файла из URL Beget S3
   * @param url URL файла в Beget S3
   * @returns Ключ файла или null
   */
  private extractKeyFromBegetS3Url(url: string): string | null {
    try {
      // Формат URL: https://bucket.s3.ru1.storage.beget.cloud/path/to/file.ext
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      
      // Извлекаем имя бакета
      const bucket = hostname.split('.')[0];
      
      // Извлекаем путь (ключ)
      const key = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
      
      return key;
    } catch {
      return null;
    }
  }

  /**
   * Проверяет, является ли URL ссылкой на Beget S3
   * @param url URL для проверки
   * @returns true, если URL указывает на Beget S3
   */
  private isBegetS3Url(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('storage.beget.cloud');
    } catch {
      return false;
    }
  }

  /**
   * Форматирует ID чата Telegram для использования в API
   * @param chatId ID чата или имя пользователя
   * @returns Отформатированный ID чата
   */
  private formatTelegramChatId(chatId: string): string {
    // Если это имя пользователя, начинающееся с @, оставляем как есть
    if (chatId.startsWith('@')) {
      return chatId;
    }
    
    // Если это числовой ID, просто возвращаем его
    return chatId;
  }

  /**
   * Форматирует URL сообщения Telegram
   * @param chatId ID чата или имя пользователя
   * @param messageId ID сообщения
   * @returns URL сообщения
   */
  private formatTelegramMessageUrl(chatId: string, messageId: number): string {
    // Убираем @ из имени пользователя, если оно есть
    const formattedChatId = chatId.startsWith('@') ? chatId.substring(1) : chatId;
    
    // Если это числовой ID канала или группы, начинающийся с -100
    if (/^-100\d+$/.test(chatId)) {
      const channelId = chatId.substring(4); // Убираем префикс -100
      return `https://t.me/c/${channelId}/${messageId}`;
    }
    
    // Если это числовой ID группы, начинающийся с -
    if (/^-\d+$/.test(chatId)) {
      const groupId = chatId.substring(1); // Убираем минус
      return `https://t.me/c/${groupId}/${messageId}`;
    }
    
    // Если это имя пользователя или числовой ID пользователя
    return `https://t.me/${formattedChatId}/${messageId}`;
  }
}

// Экспортируем экземпляр сервиса для использования в приложении
export const telegramS3Integration = new TelegramS3Integration();
```

## 8. Интеграция с сервисом Telegram для видео

### Обновите существующий сервис `server/services/social/telegram-service.ts`

Добавьте импорт и интеграцию с S3:

```typescript
import { telegramS3Integration } from '../social/telegram-s3-integration';

// В метод публикации в Telegram добавьте обработку видео
// Примерно такой код:

// Проверяем, есть ли видео в контенте
if (content.videoUrl) {
  log.info(`Publishing video to Telegram: ${content.videoUrl}`, this.logPrefix);
  
  const videoResult = await telegramS3Integration.sendVideoToTelegram(
    formattedChatId,
    token,
    content.videoUrl,
    formattedText
  );
  
  if (videoResult.success) {
    return {
      success: true,
      url: videoResult.url || '',
      messageId: videoResult.messageId
    };
  } else {
    log.error(`Failed to send video to Telegram: ${videoResult.error}`, this.logPrefix);
    // Если видео не отправилось, продолжаем обычную публикацию с изображениями
  }
}
```

## 9. Интеграция в клиентский интерфейс

Добавьте компоненты для загрузки файлов и видео в соответствующих местах интерфейса.

## Полезные ссылки для работы с Beget S3

- [Документация Beget S3](https://beget.com/ru/kb/api/s3-api)
- [AWS SDK v3 для JavaScript](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/index.html)

## Примечания

- Для работы с видео необходим установленный FFmpeg на сервере. Проверьте его наличие и установите, если необходимо.
- Не храните ключи API в коде, используйте переменные окружения.
- Регулярно очищайте хранилище от неиспользуемых файлов для экономии места и средств.