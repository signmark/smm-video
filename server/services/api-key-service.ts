import axios from 'axios';
import * as logger from '../utils/logger';

/**
 * Сервис для работы с API ключами пользователей
 */
export class ApiKeyService {
  /**
   * Получает API ключ пользователя для указанного сервиса
   * @param userId ID пользователя
   * @param serviceName Название сервиса (например, 'gemini', 'fal_ai', 'perplexity')
   * @param token Токен авторизации пользователя
   * @returns API ключ или null, если ключ не найден
   */
  async getApiKey(userId: string, serviceName: string, token?: string): Promise<string | null> {
    try {
      // Если есть Gemini API ключ в переменных окружения, используем его
      if (serviceName === 'gemini' && process.env.GEMINI_API_KEY) {
        return process.env.GEMINI_API_KEY;
      }

      // Если есть токен пользователя, пытаемся получить API ключ из Directus
      if (token) {
        // Получаем API ключи пользователя из базы данных
        const directusUrl = process.env.DIRECTUS_URL?.replace(/\/$/, ''); // Убираем слэш в конце
        const response = await axios.get(`${directusUrl}/items/user_api_keys`, {
          params: {
            filter: {
              user: userId,
              service: serviceName,
              status: {
                _eq: 'active'
              }
            },
            sort: ['-date_created'],
            limit: 1
          },
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const apiKeys = response.data?.data;

        if (apiKeys && apiKeys.length > 0) {
          logger.log(`[api-key-service] Found API key for user ${userId} and service ${serviceName}`);
          return apiKeys[0].api_key;
        }
      }

      // Если в ENV или БД ключ не найден, возвращаем null
      logger.log(`[api-key-service] API key not found for user ${userId} and service ${serviceName}`);
      return null;
    } catch (error) {
      logger.error(`[api-key-service] Error getting API key for user ${userId} and service ${serviceName}:`, error);
      return null;
    }
  }

  /**
   * Сохраняет API ключ пользователя для указанного сервиса
   * @param userId ID пользователя
   * @param serviceName Название сервиса
   * @param apiKey API ключ
   * @param token Токен авторизации пользователя
   * @returns true если ключ успешно сохранен, иначе false
   */
  async saveApiKey(userId: string, serviceName: string, apiKey: string, token: string): Promise<boolean> {
    try {
      // Сохраняем API ключ в базе данных
      const directusUrl = process.env.DIRECTUS_URL?.replace(/\/$/, ''); // Убираем слэш в конце
      await axios.post(`${directusUrl}/items/user_api_keys`, {
        user: userId,
        service: serviceName,
        api_key: apiKey,
        status: 'active'
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      logger.log(`[api-key-service] Saved API key for user ${userId} and service ${serviceName}`);
      return true;
    } catch (error) {
      logger.error(`[api-key-service] Error saving API key for user ${userId} and service ${serviceName}:`, error);
      return false;
    }
  }
}

// Экспортируем единственный экземпляр сервиса
export const apiKeyService = new ApiKeyService();