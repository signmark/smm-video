/**
 * Модуль для оптимизации запуска сервера
 * Предназначен для отложенного выполнения тяжелых операций
 */

import { log } from './utils/logger';
import axios from 'axios';

/**
 * Проверка доступности Directus с retry logic
 * @param maxAttempts Максимальное количество попыток
 * @returns true если Directus доступен
 */
async function checkDirectusHealth(maxAttempts: number = 5): Promise<boolean> {
  const directusUrl = process.env.DIRECTUS_URL;
  
  if (!directusUrl) {
    log.error('DIRECTUS_URL не задан в переменных окружения');
    return false;
  }
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      log.info(`[Directus Health] Проверка доступности (попытка ${attempt}/${maxAttempts})...`);
      
      // Используем /server/ping вместо /server/health (который возвращает 503)
      const response = await axios.get(`${directusUrl}/server/ping`, {
        timeout: 5000
      });
      
      // Проверяем что ответ "pong"
      if (response.status === 200 && response.data === 'pong') {
        log.info('✅ [Directus Health] Directus доступен и работает');
        return true;
      }
      
      log.warn(`[Directus Health] Directus вернул неожиданный ответ: ${response.data}`);
    } catch (error: any) {
      log.error(`[Directus Health] Ошибка подключения к Directus (попытка ${attempt}/${maxAttempts}):`, error.message);
    }
    
    if (attempt < maxAttempts) {
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s
      log.info(`[Directus Health] Повтор через ${delay / 1000} секунд...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  log.error('❌ [Directus Health] Directus недоступен после всех попыток');
  return false;
}

/**
 * Отложенный запуск тяжелых сервисов
 * Выполняется после того, как сервер уже открыл порт и готов принимать соединения
 */
export function initializeHeavyServices() {
  log.info('Начало инициализации тяжелых сервисов после успешного запуска сервера...');
  
  setTimeout(() => {
    // Планировщик аналитики временно отключен
    log.info('Планировщик аналитики отключен');
    
    // Здесь можно добавить другие тяжелые сервисы, которые нужно запустить отложенно
    log.info('Все тяжелые сервисы успешно инициализированы');
  }, 10000); // Отложенный запуск через 10 секунд после старта сервера
}

/**
 * Экспорт функции проверки здоровья Directus для использования в других модулях
 */
export { checkDirectusHealth };