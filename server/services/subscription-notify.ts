/**
 * AI-65: подтверждение об активации подписки.
 *
 * Отправка живёт в двух местах — одобрение из бота у администратора и одобрение
 * по ссылке из письма, — и в обоих отказ проглатывался целиком. Решение здесь
 * одно, и записано оно один раз: подписка к этому моменту уже активирована,
 * ронять запрос из-за недоставленного сообщения нельзя. Но человек заплатил и
 * не узнал, что тариф выдан. Он идёт спрашивать — а на этот вопрос до сих пор
 * не было ни одной строки в журнале.
 *
 * Отдельно важен исход отправки. Прежний код ставил validateStatus, который
 * пропускает 4xx как обычный ответ, и не смотрел на статус. Самый частый живой
 * случай — человек не начинал диалог с ботом или заблокировал его — выглядел
 * как успешная отправка.
 */
import { telegramHttp } from './social-platforms/telegram-http';
import { logEvent } from '../utils/logger';

/** Событие одно на все исходы: человеку не пришло подтверждение оплаченного тарифа. */
const EVENT = 'subscription.confirmation_undelivered';

function undelivered(fields: Record<string, unknown>, message: string): void {
  logEvent(EVENT, fields, 'warn', 'subscriptions', message);
}

/**
 * Отправляет человеку подтверждение активации. Никогда не бросает: подписка уже
 * выдана, и отказ уведомления не должен её отменять.
 */
export async function notifySubscriptionActivated(params: {
  userId: string;
  chatId: string | number;
  text: string;
  parseMode?: 'HTML';
}): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    undelivered(
      { userId: params.userId, provider: 'telegram', reason: 'bot_token_missing' },
      'Подписка активирована, но отправлять подтверждение нечем',
    );
    return;
  }

  try {
    const tg = await telegramHttp();
    const resp = await tg.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: params.chatId,
        text: params.text,
        ...(params.parseMode ? { parse_mode: params.parseMode } : {}),
      },
      {
        headers: { 'Content-Type': 'application/json' },
        // Сохраняет прежнее поведение fetch — тот не бросал на 4xx/5xx. Исход
        // теперь разбирается ниже, а не теряется.
        validateStatus: () => true,
      },
    );
    const status = Number(resp?.status ?? 0);
    if (status < 200 || status >= 300) {
      undelivered(
        { userId: params.userId, provider: 'telegram', status, reason: 'telegram_rejected' },
        'Подписка активирована, но Telegram не принял подтверждение',
      );
    }
  } catch (e: any) {
    undelivered(
      {
        userId: params.userId,
        provider: 'telegram',
        reason: e?.message ? String(e.message) : 'unknown',
      },
      'Подписка активирована, но подтверждение человеку не доставлено',
    );
  }
}
