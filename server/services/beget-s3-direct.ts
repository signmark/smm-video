/**
 * Модуль для прямого взаимодействия с Beget S3 хранилищем без использования AWS SDK
 * Этот модуль реализует базовые операции через прямые HTTP запросы
 */
import * as crypto from 'crypto';
import { log } from '../utils/logger';
import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface BegetS3Config {
  accessKey: string;
  secretKey: string;
  bucket: string;
  endpoint: string;
  region: string;
}

interface UploadResult {
  success: boolean;
  url?: string;
  key?: string;
  error?: string;
}

class BegetS3DirectService {
  private config: BegetS3Config;
  private logPrefix = 'beget-s3-direct';

  constructor() {
    const accessKey = process.env.BEGET_S3_ACCESS_KEY;
    const secretKey = process.env.BEGET_S3_SECRET_KEY;
    const bucket = process.env.BEGET_S3_BUCKET;
    const endpoint = process.env.BEGET_S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud';
    const region = process.env.BEGET_S3_REGION || 'ru-1';

    if (!accessKey || !secretKey) {
      throw new Error('Beget S3 credentials not found in environment variables');
    }

    if (!bucket) {
      throw new Error('Beget S3 bucket not specified');
    }

    this.config = {
      accessKey,
      secretKey,
      bucket,
      endpoint: endpoint.startsWith('https://') ? endpoint.substring(8) : endpoint,
      region
    };

    log.info('Beget S3 Direct Service initialized', this.logPrefix);
  }

  /**
   * Генерирует дату в формате AWS
   * @returns Объект с датой в различных форматах
   */
  private getAmzDate(): { amzDate: string, dateStamp: string } {
    const date = new Date();
    const amzDate = date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const dateStamp = amzDate.substring(0, 8);
    return { amzDate, dateStamp };
  }

  /**
   * Получает ключ для подписи AWS
   * @param key Секретный ключ
   * @param dateStamp Дата в формате YYYYMMDD
   * @param region Регион S3
   * @param service Сервис (обычно 's3')
   * @returns Ключ для подписи
   */
  private getSignatureKey(
    key: string, 
    dateStamp: string, 
    region: string, 
    service: string
  ): Buffer {
    const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    return kSigning;
  }

  /**
   * Создает канонический запрос для AWS Signature v4
   * @param method HTTP метод
   * @param canonicalUri URI запроса
   * @param queryString Строка запроса
   * @param headers Заголовки запроса
   * @param payload Тело запроса
   * @returns Канонический запрос
   */
  private createCanonicalRequest(
    method: string, 
    canonicalUri: string, 
    queryString: string, 
    headers: Record<string, string>, 
    payload: string
  ): string {
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map(key => `${key.toLowerCase()}:${headers[key]}\n`)
      .join('');

    const signedHeaders = Object.keys(headers)
      .sort()
      .map(key => key.toLowerCase())
      .join(';');

    const payloadHash = crypto.createHash('sha256').update(payload || '').digest('hex');

    return [
      method,
      canonicalUri,
      queryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');
  }

  /**
   * Создает подпись для запроса
   * @param method HTTP метод
   * @param path Путь к ресурсу
   * @param headers Заголовки запроса
   * @param payload Тело запроса
   * @returns Заголовок Authorization с подписью
   */
  private signRequest(
    method: string, 
    path: string, 
    headers: Record<string, string>, 
    payload: string = ''
  ): string {
    const { amzDate, dateStamp } = this.getAmzDate();
    const region = this.config.region;
    const service = 's3';

    // Добавляем обязательные заголовки для AWS
    const allHeaders = {
      ...headers,
      'host': `${this.config.bucket}.${this.config.endpoint}`,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': crypto.createHash('sha256').update(payload || '').digest('hex')
    };

    // Создаем канонический запрос
    const canonicalRequest = this.createCanonicalRequest(
      method,
      path,
      '',
      allHeaders,
      payload
    );

    // Создаем строку для подписи
    const algorithm = 'AWS4-HMAC-SHA256';
    const scope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      scope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');

    // Вычисляем подпись
    const signingKey = this.getSignatureKey(this.config.secretKey, dateStamp, region, service);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    // Формируем заголовок авторизации
    const signedHeaders = Object.keys(allHeaders)
      .sort()
      .map(key => key.toLowerCase())
      .join(';');

    const authorizationHeader = [
      `${algorithm} Credential=${this.config.accessKey}/${scope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`
    ].join(', ');

    return authorizationHeader;
  }

  /**
   * Загружает файл в S3 хранилище
   * @param content Содержимое файла
   * @param key Ключ файла в S3
   * @param contentType MIME-тип файла
   * @returns Результат загрузки
   */
  async uploadContent(
    content: string | Buffer, 
    key: string, 
    contentType: string = 'text/plain'
  ): Promise<UploadResult> {
    try {
      log.info(`Uploading content to Beget S3 Direct: ${key}`, this.logPrefix);

      // Используем Buffer для содержимого, если оно передано как строка
      const contentBuffer = typeof content === 'string' ? Buffer.from(content) : content;

      // Подготавливаем заголовки для запроса
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Length': contentBuffer.length.toString()
      };

      // Подписываем запрос
      const authHeader = this.signRequest('PUT', `/${key}`, headers, contentBuffer.toString());
      
      // Добавляем авторизацию в заголовки
      headers['Authorization'] = authHeader;

      // Формируем URL для загрузки
      const url = `https://${this.config.bucket}.${this.config.endpoint}/${key}`;

      // Выполняем запрос на загрузку
      const response = await axios.put(url, contentBuffer, {
        headers: headers
      });

      // Если запрос успешен - файл загружен
      if (response.status === 200) {
        const publicUrl = `https://${this.config.bucket}.${this.config.endpoint}/${key}`;
        log.info(`File uploaded successfully: ${publicUrl}`, this.logPrefix);
        return {
          success: true,
          url: publicUrl,
          key: key
        };
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }
    } catch (error) {
      log.error(`Error uploading content to Beget S3: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Загружает текстовый контент в S3 хранилище
   * @param content Текстовый контент
   * @param fileName Имя файла (опционально)
   * @param contentType MIME-тип (по умолчанию text/plain)
   * @param folder Папка для сохранения (опционально)
   * @returns Результат загрузки
   */
  async uploadTextContent(
    content: string,
    fileName?: string,
    contentType: string = 'text/plain',
    folder?: string
  ): Promise<UploadResult> {
    try {
      // Генерируем имя файла, если не указано
      const actualFileName = fileName || `content-${Date.now()}.txt`;
      
      // Формируем ключ с учетом папки
      const key = folder ? `${folder}/${actualFileName}` : actualFileName;
      
      return await this.uploadContent(content, key, contentType);
    } catch (error) {
      log.error(`Error uploading text content: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Загружает локальный файл в S3 хранилище
   * @param filePath Путь к файлу
   * @param fileName Имя файла (опционально)
   * @param contentType MIME-тип (опционально)
   * @param folder Папка для сохранения (опционально)
   * @returns Результат загрузки
   */
  async uploadLocalFile(
    filePath: string,
    fileName?: string,
    contentType?: string,
    folder?: string
  ): Promise<UploadResult> {
    try {
      // Проверяем существование файла
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      // Читаем содержимое файла
      const fileContent = fs.readFileSync(filePath);
      
      // Определяем имя файла из пути, если не указано
      const actualFileName = fileName || path.basename(filePath);
      
      // Определяем MIME-тип по расширению, если не указан
      const mimeType = contentType || this.getMimeTypeByExtension(path.extname(filePath));
      
      // Формируем ключ с учетом папки
      const key = folder ? `${folder}/${actualFileName}` : actualFileName;
      
      return await this.uploadContent(fileContent, key, mimeType);
    } catch (error) {
      log.error(`Error uploading local file: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Загружает файл из URL в S3 хранилище
   * @param url URL файла
   * @param fileName Имя файла (опционально)
   * @param contentType MIME-тип (опционально)
   * @param folder Папка для сохранения (опционально)
   * @returns Результат загрузки
   */
  async uploadFromUrl(
    url: string,
    fileName?: string,
    contentType?: string,
    folder?: string
  ): Promise<UploadResult> {
    try {
      log.info(`Downloading file from URL: ${url}`, this.logPrefix);
      
      // Загружаем файл по URL
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      
      // Получаем содержимое файла
      const fileContent = Buffer.from(response.data);
      
      // Определяем MIME-тип из ответа, если не указан
      const mimeType = contentType || response.headers['content-type'] || 'application/octet-stream';
      
      // Определяем имя файла из URL, если не указано
      const actualFileName = fileName || this.extractFileNameFromUrl(url);
      
      // Формируем ключ с учетом папки
      const key = folder ? `${folder}/${actualFileName}` : actualFileName;
      
      return await this.uploadContent(fileContent, key, mimeType);
    } catch (error) {
      log.error(`Error uploading file from URL: ${(error as Error).message}`, this.logPrefix);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Проверяет существование файла в S3 хранилище
   * @param key Ключ файла в S3
   * @returns true если файл существует, false в противном случае
   */
  async fileExists(key: string): Promise<boolean> {
    try {
      log.info(`Checking if file exists: ${key}`, this.logPrefix);
      
      // Подготавливаем заголовки для запроса
      const headers: Record<string, string> = {};
      
      // Подписываем запрос
      const authHeader = this.signRequest('HEAD', `/${key}`, headers);
      
      // Добавляем авторизацию в заголовки
      headers['Authorization'] = authHeader;
      
      // Формируем URL для проверки
      const url = `https://${this.config.bucket}.${this.config.endpoint}/${key}`;
      
      // Выполняем HEAD-запрос для проверки существования файла
      const response = await axios.head(url, {
        headers: headers,
        validateStatus: status => status < 500 // Принимаем 200 OK и 404 Not Found
      });
      
      // Если статус 200, файл существует
      const exists = response.status === 200;
      log.info(`File ${exists ? 'exists' : 'does not exist'}: ${key}`, this.logPrefix);
      return exists;
    } catch (error) {
      log.error(`Error checking file existence: ${(error as Error).message}`, this.logPrefix);
      return false;
    }
  }

  /**
   * Получает публичный URL файла
   * @param key Ключ файла в S3
   * @returns Публичный URL файла
   */
  getPublicUrl(key: string): string {
    return `https://${this.config.bucket}.${this.config.endpoint}/${key}`;
  }

  /**
   * Извлекает имя файла из URL
   * @param url URL файла
   * @returns Имя файла или случайное значение, если не удалось извлечь
   */
  private extractFileNameFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname;
      const fileName = pathname.split('/').pop() || '';
      
      // Удаляем параметры запроса, если есть
      const cleanFileName = fileName.split('?')[0];
      
      // Если имя файла пустое, генерируем случайное
      return cleanFileName || `file-${uuidv4()}.bin`;
    } catch (error) {
      // Если не удалось разобрать URL, возвращаем случайное имя
      return `file-${uuidv4()}.bin`;
    }
  }

  /**
   * Определяет MIME-тип по расширению файла
   * @param extension Расширение файла (с точкой, например .jpg)
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
}

// Экспортируем экземпляр сервиса
export const begetS3DirectService = new BegetS3DirectService();