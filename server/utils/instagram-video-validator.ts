/**
 * Утилиты для валидации и диагностики Instagram видео
 */
import { log } from './logger';

export interface VideoValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  details: {
    headers?: Record<string, string>;
    contentType?: string;
    acceptRanges?: boolean;
    contentLength?: number;
    statusCode?: number;
  };
}

/**
 * Проверяет, поддерживает ли URL видео все требования Instagram Graph API
 */
export async function validateInstagramVideoUrl(videoUrl: string): Promise<VideoValidationResult> {
  const result: VideoValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    details: {}
  };

  try {
    log.info(`[Instagram Video Validator] Checking video URL: ${videoUrl}`, 'instagram-validator');
    
    // Делаем HEAD запрос для проверки заголовков
    const response = await fetch(videoUrl, { 
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; InstagramBot/1.0; +http://www.instagram.com/)',
        'Range': 'bytes=0-1' // Тестируем поддержку Range заголовков
      }
    });

    result.details.statusCode = response.status;
    result.details.headers = Object.fromEntries(response.headers.entries());

    // Проверяем статус ответа
    if (!response.ok) {
      result.errors.push(`HTTP Error: ${response.status} ${response.statusText}`);
      result.isValid = false;
    }

    // Проверяем Content-Type
    const contentType = response.headers.get('content-type');
    result.details.contentType = contentType || 'не определен';
    
    if (!contentType || !contentType.startsWith('video/')) {
      result.errors.push(`Неправильный Content-Type: ${contentType}. Instagram требует video/mp4`);
      result.isValid = false;
    }

    // Проверяем поддержку Accept-Ranges (КРИТИЧНО для Instagram)
    const acceptRanges = response.headers.get('accept-ranges');
    result.details.acceptRanges = acceptRanges === 'bytes';
    
    if (acceptRanges !== 'bytes') {
      result.errors.push(`Accept-Ranges не поддерживается: ${acceptRanges}. Instagram требует "bytes"`);
      result.isValid = false;
    }

    // Проверяем Content-Length
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      result.details.contentLength = parseInt(contentLength);
      
      // Instagram имеет лимит на размер файла (обычно 100MB)
      const sizeMB = result.details.contentLength / (1024 * 1024);
      if (sizeMB > 100) {
        result.warnings.push(`Размер файла ${sizeMB.toFixed(1)}MB может превышать лимиты Instagram`);
      }
    } else {
      result.warnings.push('Content-Length не определен - может вызвать проблемы с Instagram');
    }

    // Проверяем поддержку partial content (206)
    try {
      const rangeResponse = await fetch(videoUrl, {
        headers: {
          'Range': 'bytes=0-100'
        }
      });

      if (rangeResponse.status === 206) {
        log.info('[Instagram Video Validator] Сервер поддерживает partial content (206)', 'instagram-validator');
      } else {
        result.warnings.push(`Сервер не поддерживает partial content (206), получен ${rangeResponse.status}`);
      }
    } catch (rangeError) {
      result.warnings.push('Не удалось проверить поддержку partial content');
    }

    // Логируем результаты
    log.info(`[Instagram Video Validator] Результат валидации:`, 'instagram-validator');
    log.info(`  URL: ${videoUrl}`, 'instagram-validator');
    log.info(`  Валидный: ${result.isValid}`, 'instagram-validator');
    log.info(`  Ошибки: ${result.errors.length}`, 'instagram-validator');
    log.info(`  Предупреждения: ${result.warnings.length}`, 'instagram-validator');
    log.info(`  Content-Type: ${result.details.contentType}`, 'instagram-validator');
    log.info(`  Accept-Ranges: ${acceptRanges}`, 'instagram-validator');
    log.info(`  Content-Length: ${result.details.contentLength || 'не определен'}`, 'instagram-validator');

    return result;

  } catch (error: any) {
    result.errors.push(`Ошибка при проверке URL: ${error.message}`);
    result.isValid = false;
    
    log.error(`[Instagram Video Validator] Ошибка: ${error.message}`, 'instagram-validator');
    return result;
  }
}

/**
 * Генерирует диагностический отчет для отладки проблем с Instagram видео
 */
export function generateVideoReport(validation: VideoValidationResult, videoUrl: string): string {
  const report = [];
  
  report.push('=== ДИАГНОСТИКА ВИДЕО ДЛЯ INSTAGRAM ===');
  report.push(`URL: ${videoUrl}`);
  report.push(`Статус: ${validation.isValid ? '✅ ВАЛИДНЫЙ' : '❌ НЕВАЛИДНЫЙ'}`);
  report.push('');

  if (validation.details.statusCode) {
    report.push(`HTTP Status: ${validation.details.statusCode}`);
  }

  if (validation.details.contentType) {
    report.push(`Content-Type: ${validation.details.contentType}`);
  }

  if (validation.details.acceptRanges !== undefined) {
    report.push(`Accept-Ranges: ${validation.details.acceptRanges ? '✅ bytes' : '❌ не поддерживается'}`);
  }

  if (validation.details.contentLength) {
    const sizeMB = validation.details.contentLength / (1024 * 1024);
    report.push(`Размер файла: ${sizeMB.toFixed(1)} MB`);
  }

  if (validation.errors.length > 0) {
    report.push('');
    report.push('🚫 ОШИБКИ:');
    validation.errors.forEach(error => {
      report.push(`  - ${error}`);
    });
  }

  if (validation.warnings.length > 0) {
    report.push('');
    report.push('⚠️ ПРЕДУПРЕЖДЕНИЯ:');
    validation.warnings.forEach(warning => {
      report.push(`  - ${warning}`);
    });
  }

  if (validation.details.headers) {
    report.push('');
    report.push('📋 HTTP ЗАГОЛОВКИ:');
    Object.entries(validation.details.headers).forEach(([key, value]) => {
      report.push(`  ${key}: ${value}`);
    });
  }

  return report.join('\n');
}

/**
 * Быстрая проверка - поддерживает ли URL все основные требования Instagram
 */
export async function quickInstagramCheck(videoUrl: string): Promise<boolean> {
  try {
    const response = await fetch(videoUrl, { method: 'HEAD' });
    
    const contentType = response.headers.get('content-type');
    const acceptRanges = response.headers.get('accept-ranges');
    
    return response.ok && 
           contentType?.startsWith('video/') === true && 
           acceptRanges === 'bytes';
  } catch {
    return false;
  }
}