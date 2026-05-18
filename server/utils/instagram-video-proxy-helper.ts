/**
 * Хелперы для работы с Instagram Video Proxy
 */
import { log } from './logger';

const PROXY_BASE_URL = process.env.PROXY_BASE_URL || 'http://localhost:5000';

/**
 * Преобразует S3 URL в прокси URL для Instagram
 */
export function convertS3UrlToInstagramProxy(s3Url: string): string {
  try {
    // Извлекаем ключ файла из S3 URL
    const url = new URL(s3Url);
    const pathParts = url.pathname.split('/');
    const fileName = pathParts[pathParts.length - 1];
    
    // Создаем прокси URL
    const proxyUrl = `${PROXY_BASE_URL}/api/instagram-video-proxy/${fileName}`;
    
    log(`[Instagram Proxy Helper] Конвертация URL:`, 'instagram-proxy');
    log(`  Оригинальный S3: ${s3Url}`, 'instagram-proxy');
    log(`  Прокси URL: ${proxyUrl}`, 'instagram-proxy');
    
    return proxyUrl;
  } catch (error: any) {
    log(`[Instagram Proxy Helper] Ошибка конвертации URL: ${error.message}`, 'instagram-proxy');
    return s3Url; // Возвращаем оригинальный URL в случае ошибки
  }
}

/**
 * Проверяет, нужно ли использовать прокси для данного URL
 */
export function shouldUseProxyForInstagram(videoUrl: string): boolean {
  try {
    const url = new URL(videoUrl);
    
    // Используем прокси для Beget S3
    if (url.hostname.includes('beget.tech') || url.hostname.includes('beget.cloud')) {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Получает прокси URL для Instagram если необходимо
 */
export function getInstagramCompatibleVideoUrl(originalUrl: string): string {
  if (shouldUseProxyForInstagram(originalUrl)) {
    return convertS3UrlToInstagramProxy(originalUrl);
  }
  
  return originalUrl;
}