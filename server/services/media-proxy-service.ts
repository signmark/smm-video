/**
 * Сервис для проксирования медиафайлов между Beget S3 и социальными сетями
 * Позволяет обойти ограничения прямого доступа к хранилищу из API соцсетей
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { log } from '../utils/logger';

/**
 * Сервис для проксирования медиафайлов
 * Скачивает файлы с Beget S3 на сервер и затем передает их в API соцсетей
 */
export class MediaProxyService {
  private tempDir: string;
  
  constructor() {
    // Создаем временную директорию или используем существующую
    this.tempDir = path.resolve(process.cwd(), 'temp');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    log(`MediaProxyService инициализирован, временная директория: ${this.tempDir}`, 'media-proxy');
  }
  
  /**
   * Проксирует медиафайл через локальный сервер
   * @param mediaUrl URL медиафайла в Beget S3
   * @param callback Функция, которая будет вызвана с локальным путем к файлу
   * @returns Результат выполнения callback
   */
  async proxyMedia<T>(mediaUrl: string, callback: (localPath: string) => Promise<T>): Promise<T> {
    // Создаем уникальное имя для временного файла
    const fileExt = this.getFileExtension(mediaUrl);
    const tempFileName = `temp-${Date.now()}-${Math.random().toString(36).substring(7)}${fileExt}`;
    const tempFilePath = path.join(this.tempDir, tempFileName);
    
    log(`Проксирование медиафайла: ${mediaUrl} -> ${tempFilePath}`, 'media-proxy');
    
    try {
      // Скачиваем файл
      await this.downloadFile(mediaUrl, tempFilePath);
      
      // Проверяем, что файл успешно скачан
      const fileSize = fs.statSync(tempFilePath).size;
      log(`Файл скачан успешно, размер: ${fileSize} байт`, 'media-proxy');
      
      if (fileSize === 0) {
        throw new Error('Скачанный файл имеет нулевой размер');
      }
      
      // Вызываем callback с путем к файлу
      const result = await callback(tempFilePath);
      
      // Удаляем временный файл
      this.cleanupFile(tempFilePath);
      
      return result;
    } catch (error: any) {
      log(`Ошибка при проксировании медиа: ${error.message}`, 'media-proxy');
      this.cleanupFile(tempFilePath);
      throw error;
    }
  }
  
  /**
   * Получает расширение файла из URL
   * @param url URL файла
   * @returns Расширение файла с точкой (.jpg, .mp4 и т.д.)
   */
  private getFileExtension(url: string): string {
    const matches = url.match(/\.([^./\\?#]+)($|\?|\#)/i);
    return matches ? `.${matches[1].toLowerCase()}` : '';
  }
  
  /**
   * Скачивает файл по URL
   * @param url URL файла
   * @param filePath Локальный путь для сохранения
   */
  private async downloadFile(url: string, filePath: string): Promise<void> {
    log(`Скачивание файла: ${url}`, 'media-proxy');
    
    const writer = fs.createWriteStream(filePath);
    
    try {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 60000, // 60 секунд таймаут
        maxContentLength: 100 * 1024 * 1024, // Лимит 100MB
        headers: {
          'Accept': '*/*',
          'User-Agent': 'SMM-Manager/1.0'
        }
      });
      
      response.data.pipe(writer);
      
      return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', (err) => {
          log(`Ошибка записи файла: ${err.message}`, 'media-proxy');
          reject(err);
        });
      });
    } catch (error: any) {
      writer.end();
      log(`Ошибка скачивания файла: ${error.message}`, 'media-proxy');
      
      if (error.response) {
        log(`Статус ответа: ${error.response.status}`, 'media-proxy');
        log(`Заголовки ответа: ${JSON.stringify(error.response.headers)}`, 'media-proxy');
      }
      
      throw error;
    }
  }
  
  /**
   * Удаляет временный файл
   * @param filePath Путь к файлу
   */
  private cleanupFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log(`Временный файл удален: ${filePath}`, 'media-proxy');
      }
    } catch (error: any) {
      log(`Ошибка при удалении файла ${filePath}: ${error.message}`, 'media-proxy');
    }
  }
}

export const mediaProxyService = new MediaProxyService();