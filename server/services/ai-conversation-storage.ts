/**
 * AI Conversation Storage Service
 * Хранилище истории диалогов с AI ассистентом в Directus
 * 
 * Позволяет AI ассистенту сохранять контекст между перезапусками
 * и вести осмысленные многоходовые диалоги
 */

import { directusCrud } from './directus-crud';

const log = (message: string, prefix = 'ai-conversation-storage') => {
  console.log(`[${prefix}] ${message}`);
};

interface ConversationMessage {
  id?: string;
  user_id: string;
  chat_id?: number;
  campaign_id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

interface SavedConversation extends ConversationMessage {
  id: string;
  created_at: Date;
}

export class AIConversationStorage {
  private collectionName = 'telegram_ai_conversations';
  private maxMessagesPerUser = 20; // Хранить последние 20 сообщений

  /**
   * Сохраняет сообщение в историю диалога
   */
  async saveMessage(message: ConversationMessage): Promise<boolean> {
    try {
      const { directusAuthManager } = await import('./directus-auth-manager');
      const adminToken = await directusAuthManager.getAdminAuthToken();
      
      if (!adminToken) {
        log('⚠️ Админский токен недоступен, сообщение не сохранено');
        throw new Error('Admin token unavailable for conversation storage');
      }

      await directusCrud.create(this.collectionName, {
        user_id: message.user_id,
        chat_id: message.chat_id,
        campaign_id: message.campaign_id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp || new Date(),
        metadata: message.metadata ? JSON.stringify(message.metadata) : null,
        created_at: new Date()
      }, { authToken: adminToken });

      log(`✅ Сообщение сохранено для user_id: ${message.user_id}`);

      // Автоочистка старых сообщений (эффективная)
      await this.cleanupOldMessages(message.user_id, message.chat_id, adminToken);
      
      return true;
    } catch (error) {
      log(`❌ КРИТИЧЕСКАЯ ОШИБКА сохранения сообщения: ${error}`);
      throw error; // Пробрасываем ошибку наверх
    }
  }

  /**
   * Загружает историю диалога для пользователя
   */
  async loadHistory(
    userId: string, 
    chatId?: number,
    limit: number = 20
  ): Promise<ConversationMessage[]> {
    try {
      const { directusAuthManager } = await import('./directus-auth-manager');
      const adminToken = await directusAuthManager.getAdminAuthToken();
      
      if (!adminToken) {
        return [];
      }

      // КРИТИЧНО: Для веб-приложения chatId = undefined, значит ищем записи с chat_id = null
      const filter: any = { user_id: { _eq: userId } };
      if (chatId !== undefined) {
        filter.chat_id = { _eq: chatId };
      } else {
        // Для веб-приложения явно ищем записи с chat_id = null
        filter.chat_id = { _null: true };
      }

      const messages = await directusCrud.list<SavedConversation>(this.collectionName, {
        filter,
        limit,
        sort: ['-timestamp'], // Сначала новые
        authToken: adminToken
      });

      if (!messages || messages.length === 0) {
        return [];
      }

      // Переворачиваем массив чтобы старые сообщения были первыми
      const history = messages.reverse().map(msg => {
        let metadata: Record<string, any> | undefined = msg.metadata as Record<string, any> | undefined;
        if (typeof msg.metadata === 'string') {
          try {
            metadata = JSON.parse(msg.metadata);
          } catch {
            metadata = undefined;
          }
        }
        return {
          id: msg.id,
          user_id: msg.user_id,
          chat_id: msg.chat_id,
          campaign_id: msg.campaign_id,
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.timestamp),
          metadata
        };
      });

      log(`📚 Загружено ${history.length} сообщений для user_id: ${userId}`);
      return history;
      
    } catch (error) {
      log(`❌ Ошибка загрузки истории: ${error}`);
      return [];
    }
  }

  /**
   * Очищает старые сообщения, оставляя только последние N (эффективная реализация)
   */
  private async cleanupOldMessages(
    userId: string, 
    chatId?: number,
    adminToken?: string
  ): Promise<void> {
    try {
      if (!adminToken) {
        const { directusAuthManager } = await import('./directus-auth-manager');
        const token = await directusAuthManager.getAdminAuthToken();
        if (!token) return;
        adminToken = token;
      }

      // КРИТИЧНО: Такой же фильтр как в loadHistory - учитываем chat_id = null для веб-приложения
      const filter: any = { user_id: { _eq: userId } };
      if (chatId !== undefined) {
        filter.chat_id = { _eq: chatId };
      } else {
        filter.chat_id = { _null: true };
      }

      // Сначала проверяем общее количество сообщений
      const allMessages = await directusCrud.list<SavedConversation>(this.collectionName, {
        filter,
        fields: ['id'],
        limit: -1, // Получаем все для подсчета
        sort: ['-timestamp'],
        authToken: adminToken
      });

      if (!allMessages || allMessages.length <= this.maxMessagesPerUser) {
        // Сообщений меньше или равно лимиту - ничего не удаляем
        return;
      }

      // ОПТИМИЗАЦИЯ: Получаем только ID старых сообщений (после первых N)
      const oldMessages = allMessages.slice(this.maxMessagesPerUser);

      if (oldMessages.length === 0) {
        return; // Нечего удалять
      }

      // Удаляем только старые записи
      for (const msg of oldMessages) {
        await directusCrud.delete(this.collectionName, msg.id, { authToken: adminToken });
      }

      log(`🧹 Удалено ${oldMessages.length} старых сообщений для user_id: ${userId}`);
      
    } catch (error) {
      log(`⚠️ Ошибка очистки старых сообщений: ${error}`);
    }
  }

  /**
   * Очищает всю историю для пользователя
   */
  async clearHistory(userId: string, chatId?: number): Promise<void> {
    try {
      const { directusAuthManager } = await import('./directus-auth-manager');
      const adminToken = await directusAuthManager.getAdminAuthToken();
      
      if (!adminToken) {
        return;
      }

      const filter: any = { user_id: { _eq: userId } };
      if (chatId) {
        filter.chat_id = { _eq: chatId };
      }

      const messages = await directusCrud.list<SavedConversation>(this.collectionName, {
        filter,
        limit: -1,
        authToken: adminToken
      });

      if (!messages || messages.length === 0) {
        return;
      }

      for (const msg of messages) {
        await directusCrud.delete(this.collectionName, msg.id, { authToken: adminToken });
      }

      log(`🗑️ История очищена для user_id: ${userId} (удалено ${messages.length} сообщений)`);
      
    } catch (error) {
      log(`❌ Ошибка очистки истории: ${error}`);
    }
  }

  /**
   * Форматирует историю для передачи в AI
   */
  formatHistoryForAI(messages: ConversationMessage[]): Array<{role: 'user' | 'assistant'; content: string; timestamp?: Date}> {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp
    }));
  }
}

// Singleton экспорт
export const aiConversationStorage = new AIConversationStorage();
