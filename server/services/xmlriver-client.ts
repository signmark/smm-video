/**
 * Клиент для работы с XMLRiver API
 * Централизует запросы к XMLRiver и обработку ответов
 */

import axios from 'axios';
import { ApiServiceName, apiKeyService } from './api-keys';
import { log } from '../utils/logger';

export class XmlRiverClient {
  private readonly baseUrl: string = 'http://xmlriver.com/wordstat/json';
  private defaultUserId: string = '16797';
  
  /**
   * Получает данные о ключевых словах из XMLRiver API с готовой конфигурацией
   * @param query Поисковый запрос
   * @param configJson Строка JSON с конфигурацией {user: string, key: string}
   * @param requestId Идентификатор запроса для логирования
   * @returns Массив данных о ключевых словах или null в случае ошибки
   */
  async getKeywordsWithConfig(query: string, configJson: string, requestId: string = Date.now().toString()): Promise<any[] | null> {
    try {
      log(`[${requestId}] Обрабатываем запрос ключевых слов с переданной конфигурацией`, 'xmlriver');
      log(`[${requestId}] Полученная конфигурация: ${configJson}`, 'xmlriver');
      
      // Парсим конфигурацию XMLRiver
      let xmlRiverUserId = this.defaultUserId;
      let xmlRiverApiKey = '';
      
      try {
        // Проверяем, является ли значение JSON-строкой
        const configObj = JSON.parse(configJson);
        
        // Проверяем, содержит ли объект необходимые поля
        if (configObj && typeof configObj === 'object') {
          if (configObj.user) xmlRiverUserId = configObj.user;
          if (configObj.key) xmlRiverApiKey = configObj.key;
          log(`[${requestId}] XMLRiver конфигурация успешно прочитана из JSON: user=${xmlRiverUserId}, key присутствует`, 'xmlriver');
        } else {
          throw new Error('Некорректный формат JSON для XMLRiver конфигурации');
        }
      } catch (e) {
        log(`[${requestId}] Ошибка при парсинге JSON конфигурации: ${e}`, 'xmlriver');
        return null;
      }
      
      // Проверка на пустой ключ API
      if (!xmlRiverApiKey) {
        log(`[${requestId}] XMLRiver API ключ пустой после парсинга конфигурации`, 'xmlriver');
        return null;
      }
      
      return await this.getKeywordsWithFixedCredentials(query, xmlRiverUserId, xmlRiverApiKey, requestId);
    } catch (error) {
      log(`[${requestId}] Ошибка при обработке запроса с конфигурацией: ${error instanceof Error ? error.message : 'Unknown error'}`, 'xmlriver');
      return null;
    }
  }
  
  /**
   * Получает данные о ключевых словах из XMLRiver API с фиксированными учетными данными
   * @param query Поисковый запрос
   * @param userId ID пользователя XMLRiver
   * @param apiKey Ключ API XMLRiver
   * @param requestId Идентификатор запроса для логирования
   * @returns Массив данных о ключевых словах или null в случае ошибки
   */
  async getKeywordsWithFixedCredentials(query: string, userId: string, apiKey: string, requestId: string = Date.now().toString()): Promise<any[] | null> {
    try {
      log(`[${requestId}] Запрос ключевых слов к XMLRiver с фиксированными данными для: ${query}`, 'xmlriver');
      
      log(`[${requestId}] Параметры запроса: user=${userId}, key=${apiKey.substring(0, 5)}..., query=${query}`, 'xmlriver');
      
      // Выполняем запрос к XMLRiver API напрямую с указанными user и key
      const response = await axios.get(this.baseUrl, {
        params: {
          user: userId,
          key: apiKey,
          query: query
        }
      });
      
      // Проверяем структуру ответа
      if (response.data?.content?.includingPhrases?.items) {
        const items = response.data.content.includingPhrases.items;
        log(`[${requestId}] Получено ${items.length} ключевых слов от XMLRiver`, 'xmlriver');
        return items;
      } else {
        log(`[${requestId}] Некорректная структура ответа от XMLRiver API`, 'xmlriver');
        console.log('XMLRiver API response:', JSON.stringify(response.data, null, 2));
        return [];
      }
    } catch (error) {
      log(`Ошибка при запросе к XMLRiver API: ${error instanceof Error ? error.message : 'Unknown error'}`, 'xmlriver');
      console.error('XMLRiver API error:', error);
      return null;
    }
  }

  /**
   * Получает данные о ключевых словах из XMLRiver API
   * @param query Поисковый запрос
   * @param userId ID пользователя в системе
   * @param token Токен авторизации Directus
   * @returns Массив данных о ключевых словах или null в случае ошибки
   */
  async getKeywords(query: string, userId: string, token?: string): Promise<any[] | null> {
    try {
      const requestId = Date.now().toString();
      log(`[${requestId}] Запрос ключевых слов к XMLRiver для: ${query} (userId: ${userId})`, 'xmlriver');

      // Получаем API ключ XMLRiver из сервиса API ключей
      const xmlRiverConfig = await apiKeyService.getApiKey(userId, 'xmlriver' as ApiServiceName, token);
      
      log(`[${requestId}] Получен API ключ от сервиса: ${xmlRiverConfig ? 'ДА' : 'НЕТ'}`, 'xmlriver');
      if (xmlRiverConfig) {
        log(`[${requestId}] Содержимое ключа XMLRiver: ${xmlRiverConfig}`, 'xmlriver');
      }
      
      if (!xmlRiverConfig) {
        log(`[${requestId}] XMLRiver ключ не найден для пользователя ${userId}`, 'xmlriver');
        return null;
      }
      
      // Парсим конфигурацию XMLRiver
      let xmlRiverUserId = this.defaultUserId;
      let xmlRiverApiKey = '';
      
      try {
        // Проверяем, является ли значение JSON-строкой
        log(`[${requestId}] Пытаемся распарсить JSON: ${xmlRiverConfig}`, 'xmlriver');
        const configObj = JSON.parse(xmlRiverConfig);
        
        // Проверяем, содержит ли объект необходимые поля
        if (configObj && typeof configObj === 'object') {
          if (configObj.user) xmlRiverUserId = configObj.user;
          if (configObj.key) xmlRiverApiKey = configObj.key;
          log(`[${requestId}] XMLRiver конфигурация успешно прочитана из JSON: user=${xmlRiverUserId}, key=${xmlRiverApiKey ? 'присутствует' : 'отсутствует'}`, 'xmlriver');
        } else {
          throw new Error('Некорректный формат JSON для XMLRiver конфигурации');
        }
      } catch (e) {
        // Проверяем, является ли исходная строка простым форматом user:key
        if (xmlRiverConfig.includes(':')) {
          try {
            const [user, key] = xmlRiverConfig.split(':');
            xmlRiverUserId = user.trim();
            xmlRiverApiKey = key.trim();
            log(`[${requestId}] XMLRiver конфигурация прочитана из старого формата user:key`, 'xmlriver');
          } catch (splitError) {
            log(`[${requestId}] Не удалось разделить строку конфигурации: ${splitError}`, 'xmlriver');
            return null;
          }
        } else {
          // Если не удалось распарсить JSON и не найден разделитель ':', предполагаем, что это просто ключ
          xmlRiverApiKey = xmlRiverConfig;
          log(`[${requestId}] Используем XMLRiver конфигурацию как есть, с user_id по умолчанию: ${xmlRiverUserId}`, 'xmlriver');
        }
      }
      
      // Проверка на пустой ключ API
      if (!xmlRiverApiKey) {
        log(`[${requestId}] XMLRiver API ключ пустой после парсинга конфигурации`, 'xmlriver');
        return null;
      }
      
      // Выполняем запрос к XMLRiver API
      log(`[${requestId}] Выполняем запрос к XMLRiver API: ${this.baseUrl}`, 'xmlriver');
      log(`[${requestId}] Параметры запроса: user=${xmlRiverUserId}, key=${xmlRiverApiKey.substring(0, 5)}..., query=${query}`, 'xmlriver');
      
      const response = await axios.get(this.baseUrl, {
        params: {
          user: xmlRiverUserId,
          key: xmlRiverApiKey,
          query: query
        }
      });
      
      // Проверяем структуру ответа
      if (response.data?.content?.includingPhrases?.items) {
        const items = response.data.content.includingPhrases.items;
        log(`[${requestId}] Получено ${items.length} ключевых слов от XMLRiver`, 'xmlriver');
        return items;
      } else {
        log(`[${requestId}] Некорректная структура ответа от XMLRiver API`, 'xmlriver');
        return [];
      }
    } catch (error) {
      log(`Ошибка при запросе к XMLRiver API: ${error instanceof Error ? error.message : 'Unknown error'}`, 'xmlriver');
      console.error('XMLRiver API error:', error);
      return null;
    }
  }
}

export const xmlRiverClient = new XmlRiverClient();