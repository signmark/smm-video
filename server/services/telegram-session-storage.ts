import { directusCrud } from './directus-crud';
import { log } from '../utils/logger';

/**
 * Интерфейс сессии Telegram бота
 */
export interface TelegramSession {
  id?: number;
  chat_id: number;
  user_id?: string;
  token?: string;
  refresh_token?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  session_data?: Record<string, any>;
  token_expires_at?: Date;
  last_activity?: Date;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * Сервис для хранения Telegram сессий в Directus
 */
export class TelegramSessionStorage {
  private logPrefix = 'telegram-session-storage';
  private collectionName = 'telegram_sessions';

  /**
   * Проверяет доступность коллекции telegram_sessions
   * Примечание: Коллекция должна быть создана вручную в Directus
   */
  async checkCollection(): Promise<boolean> {
    try {
      // Получаем админский токен для доступа к системной коллекции
      const { directusAuthManager } = await import('./directus-auth-manager');
      const adminToken = await directusAuthManager.getAdminAuthToken();
      
      if (!adminToken) {
        log(`⚠️ Админский токен недоступен для проверки коллекции ${this.collectionName}`, this.logPrefix);
        return false;
      }
      
      // Пробуем получить список записей (даже пустой) для проверки доступности
      await directusCrud.list<TelegramSession>(this.collectionName, {
        limit: 1,
        authToken: adminToken
      });
      
      return true;
    } catch (error) {
      log(`⚠️ Коллекция ${this.collectionName} недоступна. Создайте её вручную в Directus.`, this.logPrefix);
      log(`Детали ошибки: ${error}`, this.logPrefix);
      return false;
    }
  }

  /**
   * Сохраняет или обновляет сессию
   */
  async saveSession(chatId: number, sessionData: Partial<TelegramSession>): Promise<void> {
    try {
      // Получаем админский токен для работы с системной коллекцией
      const { directusAuthManager } = await import('./directus-auth-manager');
      const adminToken = await directusAuthManager.getAdminAuthToken();
      
      if (!adminToken) {
        log(`⚠️ Админский токен недоступен, сессия не сохранена для chat_id: ${chatId}`, this.logPrefix);
        return;
      }
      
      const existingSession = await this.getSession(chatId);
      
      const data = {
        chat_id: chatId,
        ...sessionData,
        last_activity: new Date(),
        updated_at: new Date()
      };

      if (existingSession && existingSession.id) {
        // Обновляем существующую сессию
        await directusCrud.update(this.collectionName, existingSession.id, data, { authToken: adminToken });
        log(`Сессия обновлена для chat_id: ${chatId}`, this.logPrefix);
      } else {
        // Создаем новую сессию
        await directusCrud.create(this.collectionName, {
          ...data,
          created_at: new Date()
        }, { authToken: adminToken });
        log(`Новая сессия создана для chat_id: ${chatId}`, this.logPrefix);
      }
    } catch (error) {
      log(`Ошибка сохранения сессии для chat_id ${chatId}: ${error}`, this.logPrefix);
      // Не бросаем ошибку, продолжаем работу
    }
  }

  /**
   * Загружает сессию по chat_id
   */
  async getSession(chatId: number): Promise<TelegramSession | null> {
    try {
      // Получаем админский токен для работы с системной коллекцией
      const { directusAuthManager } = await import('./directus-auth-manager');
      const adminToken = await directusAuthManager.getAdminAuthToken();
      
      if (!adminToken) {
        return null;
      }
      
      const items = await directusCrud.list<TelegramSession>(this.collectionName, {
        filter: {
          chat_id: { _eq: chatId }
        },
        limit: 1,
        authToken: adminToken
      });

      if (items && items.length > 0) {
        return items[0];
      }

      return null;
    } catch (error) {
      log(`Ошибка загрузки сессии для chat_id ${chatId}: ${error}`, this.logPrefix);
      return null;
    }
  }

  /**
   * Загружает все активные сессии
   */
  async getAllSessions(): Promise<TelegramSession[]> {
    try {
      // Получаем админский токен для работы с системной коллекцией
      const { directusAuthManager } = await import('./directus-auth-manager');
      const adminToken = await directusAuthManager.getAdminAuthToken();
      
      if (!adminToken) {
        return [];
      }
      
      const items = await directusCrud.list<TelegramSession>(this.collectionName, {
        filter: {
          token: { _nnull: true }
        },
        limit: -1, // Все записи
        authToken: adminToken
      });

      return items || [];
    } catch (error) {
      log(`Ошибка загрузки всех сессий: ${error}`, this.logPrefix);
      return [];
    }
  }

  /**
   * Удаляет сессию по chatId
   */
  async deleteSession(chatId: number): Promise<void> {
    try {
      // Получаем админский токен для работы с системной коллекцией
      const { directusAuthManager } = await import('./directus-auth-manager');
      const adminToken = await directusAuthManager.getAdminAuthToken();
      
      if (!adminToken) {
        return;
      }
      
      const session = await this.getSession(chatId);
      
      if (session && session.id) {
        await directusCrud.delete(this.collectionName, session.id, { authToken: adminToken });
        log(`Сессия удалена для chat_id: ${chatId}`, this.logPrefix);
      }
    } catch (error) {
      log(`Ошибка удаления сессии для chat_id ${chatId}: ${error}`, this.logPrefix);
    }
  }

  /**
   * Удаляет все сессии пользователя по userId
   */
  async deleteSessionByUserId(userId: string): Promise<void> {
    try {
      const { directusAuthManager } = await import('./directus-auth-manager');
      const adminToken = await directusAuthManager.getAdminAuthToken();
      
      if (!adminToken) {
        return;
      }
      
      // Находим все сессии пользователя
      const sessions = await directusCrud.list<TelegramSession>(this.collectionName, {
        filter: {
          user_id: { _eq: userId }
        },
        limit: -1,
        authToken: adminToken
      });
      
      // Удаляем каждую сессию
      for (const session of sessions) {
        if (session.id) {
          await directusCrud.delete(this.collectionName, session.id, { authToken: adminToken });
          log(`Сессия удалена для user_id: ${userId}, chat_id: ${session.chat_id}`, this.logPrefix);
        }
      }
    } catch (error) {
      log(`Ошибка удаления сессий для user_id ${userId}: ${error}`, this.logPrefix);
    }
  }

  /**
   * Обновляет токен в сессии
   */
  async updateToken(
    chatId: number, 
    token: string, 
    refreshToken?: string,
    expiresAt?: Date
  ): Promise<void> {
    try {
      // Получаем админский токен для работы с системной коллекцией
      const { directusAuthManager } = await import('./directus-auth-manager');
      const adminToken = await directusAuthManager.getAdminAuthToken();
      
      if (!adminToken) {
        return;
      }
      
      const session = await this.getSession(chatId);
      
      if (session && session.id) {
        await directusCrud.update(this.collectionName, session.id, {
          token,
          refresh_token: refreshToken || session.refresh_token,
          token_expires_at: expiresAt,
          updated_at: new Date()
        }, { authToken: adminToken });
        
        log(`Токен обновлен для chat_id: ${chatId}`, this.logPrefix);
      }
    } catch (error) {
      log(`Ошибка обновления токена для chat_id ${chatId}: ${error}`, this.logPrefix);
    }
  }

  /**
   * Обновляет токены для всех сессий пользователя (по user_id)
   * CRITICAL: Синхронизирует новый refresh_token в БД после автоматического обновления
   * Вызывается из DirectusAuthManager после каждого refresh для сохранения нового refresh_token
   * @param adminToken Админский токен (передаётся извне чтобы избежать циклических зависимостей)
   */
  async updateTokensForUser(
    userId: string,
    accessToken: string,
    refreshToken: string,
    expiresAt?: Date,
    adminToken?: string
  ): Promise<void> {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        // Если админский токен не передан, пытаемся получить его
        let authToken: string | null = adminToken || null;
        if (!authToken) {
          const { directusAuthManager } = await import('./directus-auth-manager');
          authToken = await directusAuthManager.getAdminAuthToken();
        }
        
        if (!authToken) {
          log(`⚠️ Админский токен недоступен, токены не обновлены для user_id: ${userId}`, this.logPrefix);
          return;
        }
        
        // Ищем все сессии для этого пользователя
        const sessions = await directusCrud.list<TelegramSession>(this.collectionName, {
          authToken,
          filter: { user_id: { _eq: userId } },
          limit: -1
        });
        
        if (!sessions || sessions.length === 0) {
          log(`⚠️ Сессии не найдены для user_id: ${userId}`, this.logPrefix);
          return;
        }
        
        // Обновляем все сессии пользователя (может быть несколько чатов)
        const updatePromises = sessions.map(async (session) => {
          if (session.id) {
            await directusCrud.update(this.collectionName, session.id, {
              token: accessToken,
              refresh_token: refreshToken,
              token_expires_at: expiresAt,
              updated_at: new Date()
            }, { authToken }); // КРИТИЧНО: используем resolved authToken, а не исходный adminToken!
            
            return session.chat_id;
          }
          return null;
        });
        
        const updatedChatIds = await Promise.all(updatePromises);
        const successCount = updatedChatIds.filter(id => id !== null).length;
        
        log(`✅ [TOKEN-SYNC] Refresh token синхронизирован в БД для user_id: ${userId}, обновлено сессий: ${successCount}/${sessions.length}`, this.logPrefix);
        
        // Успешно обновили - выходим
        return;
        
      } catch (error) {
        attempt++;
        log(`❌ [TOKEN-SYNC] Попытка ${attempt}/${maxRetries} - Ошибка синхронизации refresh token для user_id ${userId}: ${error}`, this.logPrefix);
        
        if (attempt >= maxRetries) {
          log(`❌ [TOKEN-SYNC] Превышено количество попыток синхронизации для user_id: ${userId}`, this.logPrefix);
          // Не прерываем работу приложения - токен остался в кэше
          return;
        }
        
        // Экспоненциальная задержка перед следующей попыткой
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  /**
   * Очищает устаревшие сессии (старше 30 дней без активности)
   */
  async cleanupOldSessions(): Promise<void> {
    try {
      // Получаем админский токен для работы с системной коллекцией
      const { directusAuthManager } = await import('./directus-auth-manager');
      const adminToken = await directusAuthManager.getAdminAuthToken();
      
      if (!adminToken) {
        return;
      }
      
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const oldSessions = await directusCrud.list<TelegramSession>(this.collectionName, {
        filter: {
          last_activity: { _lt: thirtyDaysAgo.toISOString() }
        },
        limit: -1,
        authToken: adminToken
      });

      if (oldSessions && oldSessions.length > 0) {
        for (const session of oldSessions) {
          if (session.id) {
            await directusCrud.delete(this.collectionName, session.id, { authToken: adminToken });
          }
        }
        
        log(`Удалено ${oldSessions.length} устаревших сессий`, this.logPrefix);
      }
    } catch (error) {
      log(`Ошибка очистки устаревших сессий: ${error}`, this.logPrefix);
    }
  }
}

// Экспортируем синглтон
export const telegramSessionStorage = new TelegramSessionStorage();
