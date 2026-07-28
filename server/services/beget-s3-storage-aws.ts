/**
 * Сервис для работы с Beget S3 хранилищем через AWS SDK v3
 * 
 * Реализация с использованием официального AWS SDK
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
import { safeFetch } from '../utils/safe-http';

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
   * @param options Опции для загрузки файла
   * @returns Результат загрузки файла
   */
  async uploadFile(options: {
    key?: string;
    filePath?: string;
    fileData?: Buffer | string;
    contentType?: string;
  }): Promise<UploadFileResult> {
    try {
      let fileKey = options.key;
      let fileBody: Buffer | string;
      let contentType = options.contentType || 'application/octet-stream';
      
      // Санитизируем ключ если он передан напрямую
      if (fileKey) {
        // Разделяем путь и имя файла для санитизации
        const parts = fileKey.split('/');
        const fileName = parts.pop() || '';
        const sanitizedFileName = this.sanitizeFileName(fileName);
        fileKey = parts.length > 0 ? `${parts.join('/')}/${sanitizedFileName}` : sanitizedFileName;
      }
      
      // Если указан путь к файлу, читаем его содержимое
      if (options.filePath) {
        if (!fs.existsSync(options.filePath)) {
          throw new Error(`File not found: ${options.filePath}`);
        }
        
        fileBody = fs.readFileSync(options.filePath);
        
        // Если ключ не указан, генерируем его из имени файла
        if (!fileKey) {
          fileKey = this.generateFileKey(path.basename(options.filePath));
        }
        
        // Если тип контента не указан, определяем по расширению файла
        if (!options.contentType) {
          contentType = this.getMimeTypeByExtension(path.extname(options.filePath));
        }
      } else if (options.fileData) {
        // Используем переданные данные файла
        fileBody = options.fileData;
        
        // Если ключ не указан, генерируем случайный
        if (!fileKey) {
          fileKey = this.generateFileKey();
        }
      } else {
        throw new Error('Either filePath or fileData must be provided');
      }
      
      log.info(`Uploading file to Beget S3: ${fileKey}`, this.logPrefix);
      
      // Для видео файлов добавляем специальные заголовки, требуемые Instagram Graph API
      const metadata: Record<string, string> = {};
      const cacheControl = contentType.startsWith('video/') ? 'public, max-age=31536000' : 'public, max-age=3600';
      
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: fileKey,
        Body: fileBody,
        ContentType: contentType,
        ACL: 'public-read',
        CacheControl: cacheControl,
        Metadata: metadata
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
      
      const localFileName = fileName || path.basename(filePath);
      const mimeType = contentType || this.getMimeTypeByExtension(path.extname(filePath));
      
      let key = localFileName;
      if (folder) {
        key = `${folder}/${localFileName}`;
      }

      return this.uploadFile({
        filePath,
        key,
        contentType: mimeType
      });
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
      
      // safeFetch: тело ответа уезжает в S3 и становится публично доступным —
      // без проверки это прямая эксфильтрация внутренних сервисов.
      const response = await safeFetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch file from URL: ${response.status}`);
      }
      
      const fileData = await response.arrayBuffer();
      const buffer = Buffer.from(fileData);
      
      // Определяем тип контента
      const mimeType = contentType || response.headers.get('content-type') || 'application/octet-stream';
      
      // Если имя файла не указано, попробуем получить из URL
      const detectedFileName = fileName || this.extractFileNameFromUrl(url);
      
      let key = detectedFileName;
      if (folder) {
        key = `${folder}/${detectedFileName}`;
      }
      
      return this.uploadFile({
        key,
        fileData: buffer,
        contentType: mimeType
      });
    } catch (error) {
      log.error(`Error uploading file from URL to Beget S3: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
  
  /**
   * Загружает строковый контент или данные в виде строки в S3 хранилище
   * @param content Строковый контент или данные для загрузки
   * @param fileName Имя файла (если не указано, генерируется автоматически)
   * @param contentType MIME-тип контента (по умолчанию 'text/plain')
   * @param folder Папка для сохранения (опционально)
   * @returns Результат загрузки контента
   */
  async uploadContent(
    content: string,
    fileName?: string,
    contentType: string = 'text/plain',
    folder?: string
  ): Promise<UploadFileResult> {
    try {
      log.info(`Uploading content to Beget S3, size: ${content.length} bytes`, this.logPrefix);
      
      // Если имя файла не указано, генерируем его
      const actualFileName = fileName || `content-${Date.now()}.txt`;
      
      // Определяем итоговый ключ с учетом папки
      let key = actualFileName;
      if (folder) {
        key = `${folder}/${actualFileName}`;
      }
      
      // Загружаем строковый контент как файл
      return this.uploadFile({
        key,
        fileData: content,
        contentType
      });
    } catch (error) {
      log.error(`Error uploading content to Beget S3: ${(error as Error).message}`, this.logPrefix);
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
      
      // Используем стандартный интерфейс AWS SDK v3 для получения данных тела
      const arrayBuffer = await response.Body.transformToByteArray();
      const buffer = Buffer.from(arrayBuffer);
      log.info(`File retrieved successfully, size: ${buffer.length} bytes`, this.logPrefix);
      return buffer;
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
      
      // Приводим типы в соответствии с интерфейсом SDK
      const files: string[] = [];
      if (response.Contents && Array.isArray(response.Contents)) {
        for (const item of response.Contents) {
          if (item.Key) {
            files.push(item.Key);
          }
        }
      }
      
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

// Экспортируем экземпляр сервиса с отложенной инициализацией
let _begetS3StorageAws: BegetS3StorageAws | null = null;

export const begetS3StorageAws = new Proxy({} as BegetS3StorageAws, {
  get(_target, prop) {
    if (!_begetS3StorageAws) {
      try {
        _begetS3StorageAws = new BegetS3StorageAws();
      } catch (err) {
        console.warn('[BegetS3] Service not available (missing credentials):', (err as Error).message);
        return () => Promise.reject(new Error('Beget S3 service not configured: ' + (err as Error).message));
      }
    }
    const value = (_begetS3StorageAws as any)[prop];
    return typeof value === 'function' ? value.bind(_begetS3StorageAws) : value;
  }
});