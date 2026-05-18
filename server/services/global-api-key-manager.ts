/**
 * Универсальный менеджер для получения API ключей из Directus Global API Keys
 * Отвечает за централизованное управление всеми AI сервисами
 */

import { GlobalApiKeysService } from './global-api-keys';
import { ApiServiceName } from './api-keys';
import * as logger from '../utils/logger';

export class GlobalApiKeyManager {
  private static instance: GlobalApiKeyManager;
  private globalApiKeysService: GlobalApiKeysService;
  
  constructor() {
    this.globalApiKeysService = new GlobalApiKeysService();
  }
  
  static getInstance(): GlobalApiKeyManager {
    if (!GlobalApiKeyManager.instance) {
      GlobalApiKeyManager.instance = new GlobalApiKeyManager();
    }
    return GlobalApiKeyManager.instance;
  }
  
  /**
   * Получает API ключ для указанного сервиса из Directus
   * @param serviceName Название сервиса
   * @returns API ключ или null если не найден
   */
  async getApiKey(serviceName: ApiServiceName): Promise<string | null> {
    try {
      const apiKey = await this.globalApiKeysService.getGlobalApiKey(serviceName);
      
      if (apiKey) {
        logger.log(`Successfully retrieved ${serviceName} API key from Directus`, 'global-api-key-manager');
        return apiKey;
      } else {
        logger.error(`${serviceName} API key not found in Directus Global API Keys`, 'global-api-key-manager');
        return null;
      }
    } catch (error) {
      logger.error(`Error retrieving ${serviceName} API key from Directus:`, error);
      return null;
    }
  }
  
  /**
   * Проверяет доступность API ключа для сервиса
   * @param serviceName Название сервиса
   * @returns true если ключ доступен, false если нет
   */
  async isApiKeyAvailable(serviceName: ApiServiceName): Promise<boolean> {
    const apiKey = await this.getApiKey(serviceName);
    return apiKey !== null && apiKey.length > 0;
  }
}

// Экспортируем singleton экземпляр
export const globalApiKeyManager = GlobalApiKeyManager.getInstance();