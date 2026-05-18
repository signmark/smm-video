import type { InsertSupportMessage } from '@shared/schema';
import { getTelegramBot } from '../telegram-bot/bot-launcher';
import { sendSupportEmail } from './email';

/**
 * Сервис для обработки сообщений технической поддержки
 */

interface SupportServiceDependencies {
  emailSender?: any; // TODO: Типизировать когда добавим интеграцию
}

export class SupportService {
  private emailSender?: any;
  
  constructor(dependencies: SupportServiceDependencies = {}) {
    this.emailSender = dependencies.emailSender;
  }
  
  /**
   * Отправляет сообщение в техподдержку
   * 
   * @param message - Данные сообщения
   * @returns ticketId - Уникальный ID обращения
   */
  async sendSupportMessage(message: InsertSupportMessage): Promise<{ ticketId: string }> {
    // Генерируем уникальный ID для обращения
    const ticketId = `SUPPORT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log('[SUPPORT] Новое обращение в техподдержку:', {
      ticketId,
      userId: message.userId,
      messagePreview: message.message.substring(0, 100),
      timestamp: new Date().toISOString()
    });
    
    // Интеграция с Telegram для уведомления админа
    const bot = getTelegramBot();
    const supportChatId = process.env.SUPPORT_CHAT_ID || '276351686'; // Dmitry's ID as default

    if (bot) {
      try {
        const formattedMsg = `🆘 <b>Новое обращение в поддержку</b>\n\n` +
          `<b>ID:</b> <code>${ticketId}</code>\n` +
          `<b>User ID:</b> <code>${message.userId}</code>\n` +
          `<b>Сообщение:</b>\n${message.message}`;
          
        await bot.sendMessage(supportChatId, formattedMsg);
        console.log('[SUPPORT] Уведомление отправлено в Telegram админу');
      } catch (error) {
        console.error('[SUPPORT] Ошибка отправки уведомления в Telegram:', error);
      }
    } else {
      console.warn('[SUPPORT] Telegram бот не запущен, уведомление пропущено');
    }
    
    sendSupportEmail(message.userId, (message as any).email || '', message.message, ticketId).catch(
      (err) => console.error('[SUPPORT] Ошибка email-уведомления:', err?.message)
    );
    
    // TODO: Сохранение в БД (когда добавим persistence)
    
    return { ticketId };
  }
}

// Экспорт singleton instance
export const supportService = new SupportService();
