import { geminiDirect } from './gemini-direct';
import * as logger from '../utils/logger';

interface SupportMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface SupportSession {
  sessionId: string;
  userId?: string;
  messages: SupportMessage[];
  needsOperator: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Сервис AI поддержки с использованием Gemini
 * Отвечает на вопросы пользователей о приложении
 * Может эскалировать сложные запросы к оператору через Chatwoot
 */
export class AISupportService {
  private sessions: Map<string, SupportSession> = new Map();
  
  private readonly SYSTEM_PROMPT = `Ты - умный помощник поддержки для SMM Manager - платформы управления контентом в социальных сетях.

ОСНОВНЫЕ ВОЗМОЖНОСТИ ПРИЛОЖЕНИЯ:
- Создание и управление кампаниями для социальных сетей
- AI-генерация контента (тексты, изображения, видео) на русском, английском и испанском языках
- Публикация в Facebook, Instagram, VK, Telegram, YouTube
- Сбор и анализ трендов из социальных сетей
- Анализ настроений комментариев
- Автоматическое планирование публикаций
- Генерация отчетов в PDF/Excel
- База данных Telegram каналов с умным поиском
- Telegram бот для удаленного управления
- AI ассистент для автономного управления кампаниями

ОСНОВНЫЕ РАЗДЕЛЫ:
1. Кампании - создание и управление SMM кампаниями
2. Контент - генерация постов с помощью AI
3. Тренды - сбор актуальных тем из соцсетей
4. Аналитика - статистика и отчеты
5. Stories - создание историй для соцсетей
6. Telegram каналы - поиск и рекомендации каналов

ЧАСТО ЗАДАВАЕМЫЕ ВОПРОСЫ:

Q: Как создать кампанию?
A: Перейдите в раздел "Кампании" и нажмите "Создать кампанию". Заполните название, выберите соцсети и настройте параметры.

Q: Как сгенерировать контент?
A: В разделе "Контент" выберите кампанию, укажите тему и AI создаст пост. Можно редактировать и добавлять изображения.

Q: Как собрать тренды?
A: В разделе "Тренды" выберите кампанию, добавьте источники и нажмите "Собрать тренды". AI соберет актуальные посты.

Q: Как опубликовать пост?
A: В календаре выберите дату/время, создайте пост и нажмите "Запланировать". Пост опубликуется автоматически.

Q: Как работает AI ассистент?
A: AI ассистент может самостоятельно создавать кампании, собирать тренды, генерировать контент и планировать публикации по вашей команде.

ТВОЯ РОЛЬ:
- Отвечай кратко, понятно и по-дружески на русском языке
- Помогай пользователям разобраться с функциями
- Давай конкретные инструкции с шагами
- Если вопрос слишком сложный или требует технической поддержки - предложи вызвать оператора
- Используй эмодзи для дружелюбности

КОГДА ПРЕДЛАГАТЬ ОПЕРАТОРА:
- Технические ошибки и баги
- Проблемы с оплатой или подпиской
- Запросы на доработку функционала
- Вопросы о безопасности данных
- Любые проблемы, которые ты не можешь решить

Отвечай ТОЛЬКО на вопросы о приложении. Если вопрос не связан с SMM Manager - вежливо скажи что можешь помочь только с вопросами о платформе.`;

  /**
   * Получить или создать сессию
   */
  private getOrCreateSession(sessionId: string, userId?: string): SupportSession {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        userId,
        messages: [{
          role: 'system',
          content: this.SYSTEM_PROMPT,
          timestamp: new Date()
        }],
        needsOperator: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    return this.sessions.get(sessionId)!;
  }

  /**
   * Обработать сообщение пользователя
   */
  async processMessage(params: {
    sessionId: string;
    message: string;
    userId?: string;
  }): Promise<{
    response: string;
    needsOperator: boolean;
    sessionId: string;
  }> {
    const { sessionId, message, userId } = params;
    
    try {
      logger.info(`[ai-support] Processing message for session ${sessionId}, length: ${message.length}`);
      
      // Получаем или создаем сессию
      const session = this.getOrCreateSession(sessionId, userId);
      
      // Добавляем сообщение пользователя
      session.messages.push({
        role: 'user',
        content: message,
        timestamp: new Date()
      });
      
      // Формируем контекст для Gemini (последние 10 сообщений)
      const recentMessages = session.messages.slice(-10);
      const conversationHistory = recentMessages
        .filter(m => m.role !== 'system')
        .map(m => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content}`)
        .join('\n');
      
      const fullPrompt = `${this.SYSTEM_PROMPT}

ИСТОРИЯ РАЗГОВОРА:
${conversationHistory}

Пользователь: ${message}

Твой ответ (краткий и полезный):`;

      // Генерируем ответ через Gemini
      const aiResponse = await geminiDirect.generateContent({
        prompt: fullPrompt,
        model: 'gemini-3-flash-preview'
      });
      
      // Добавляем ответ в историю
      session.messages.push({
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date()
      });
      
      // Определяем нужен ли оператор
      const needsOperator = this.detectOperatorNeed(message, aiResponse);
      if (needsOperator) {
        session.needsOperator = true;
      }
      
      session.updatedAt = new Date();
      
      // Ограничиваем размер истории (максимум 50 сообщений)
      if (session.messages.length > 50) {
        session.messages = [
          session.messages[0], // системный промпт
          ...session.messages.slice(-49) // последние 49 сообщений
        ];
      }
      
      logger.info(`[ai-support] Response generated for session ${sessionId}, length: ${aiResponse.length}, needsOperator: ${needsOperator}`);
      
      return {
        response: aiResponse,
        needsOperator,
        sessionId
      };
      
    } catch (error) {
      logger.error('[ai-support] Error processing message:', error);
      throw new Error(`Ошибка обработки сообщения: ${(error as Error).message}`);
    }
  }

  /**
   * Определить нужен ли оператор на основе сообщения и ответа
   */
  private detectOperatorNeed(userMessage: string, aiResponse: string): boolean {
    const operatorKeywords = [
      'не могу помочь',
      'обратитесь к оператору',
      'технической поддержки',
      'вызвать оператора',
      'связаться с поддержкой',
      'ошибка',
      'баг',
      'не работает',
      'проблема с оплатой',
      'возврат средств'
    ];
    
    const userOperatorKeywords = [
      'оператор',
      'человек',
      'поддержка',
      'менеджер',
      'специалист'
    ];
    
    const messageLower = userMessage.toLowerCase();
    const responseLower = aiResponse.toLowerCase();
    
    // Проверяем запрос пользователя на оператора
    const userWantsOperator = userOperatorKeywords.some(keyword => 
      messageLower.includes(keyword)
    );
    
    // Проверяем рекомендацию AI обратиться к оператору
    const aiSuggestsOperator = operatorKeywords.some(keyword =>
      responseLower.includes(keyword)
    );
    
    return userWantsOperator || aiSuggestsOperator;
  }

  /**
   * Получить историю сессии
   */
  getSessionHistory(sessionId: string): SupportMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }
    
    // Возвращаем все сообщения кроме системного промпта
    return session.messages.filter(m => m.role !== 'system');
  }

  /**
   * Пометить сессию как требующую оператора
   */
  markNeedsOperator(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.needsOperator = true;
      session.updatedAt = new Date();
      logger.info(`[ai-support] Session ${sessionId} marked as needing operator`);
    }
  }

  /**
   * Очистить старые сессии (старше 24 часов)
   */
  cleanupOldSessions(): void {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    Array.from(this.sessions.entries()).forEach(([sessionId, session]) => {
      if (session.updatedAt < oneDayAgo) {
        this.sessions.delete(sessionId);
        logger.info(`[ai-support] Cleaned up old session ${sessionId}`);
      }
    });
  }
}

// Экспортируем singleton
export const aiSupportService = new AISupportService();

// Запускаем очистку старых сессий каждые 6 часов
setInterval(() => {
  aiSupportService.cleanupOldSessions();
}, 6 * 60 * 60 * 1000);
