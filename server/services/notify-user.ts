/**
 * Доставка уведомлений владельцу кампании: сначала Telegram, при неудаче — email.
 *
 * Раньше эта логика жила внутри vk-token-refresh.ts и умела рассказывать ровно про
 * протухший VK-токен. Уведомления о комментариях и охвате ходят тем же путём, поэтому
 * доставка вынесена сюда, а текст сообщения передаётся вызывающим.
 *
 * Telegram-адресат берётся из коллекции telegram_sessions: там лежит chat_id того,
 * кто залогинился в бота через /login. Нет сессии — значит бот пользователя не знает,
 * и остаётся только почта.
 */

import axios from 'axios';
import { log } from '../utils/logger';
import { sendEmail } from './email';

export interface UserNotification {
  /** Directus user id владельца кампании. */
  userId: string;
  /** Текст для Telegram в HTML-разметке Telegram (b, a, i). */
  telegramText: string;
  /** Письмо-запасной вариант. Без него при отсутствии Telegram уведомление просто не уйдёт. */
  email?: {
    subject: string;
    html: string;
    text: string;
  };
}

export type NotifyChannel = 'telegram' | 'email' | 'none';

export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getDirectusConfig(): { adminToken: string; directusUrl: string } | null {
  const adminToken = process.env.DIRECTUS_STATIC_TOKEN;
  const directusUrl = process.env.DIRECTUS_URL;
  if (!adminToken || !directusUrl) return null;
  return { adminToken, directusUrl };
}

/**
 * Шлёт сообщение во все Telegram-сессии пользователя.
 * Возвращает true, если хотя бы одна доставка удалась.
 */
async function tryTelegram(
  userId: string,
  text: string,
  adminToken: string,
  directusUrl: string,
): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const response = await axios.get(`${directusUrl}/items/telegram_sessions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { 'filter[user_id][_eq]': userId, limit: 10 },
      timeout: 10000,
    });
    const sessions: Array<{ chat_id: number }> = response.data?.data || [];
    if (sessions.length === 0) return false;

    const apiBase = `https://api.telegram.org/bot${botToken}`;
    let sent = false;
    for (const session of sessions) {
      try {
        await axios.post(`${apiBase}/sendMessage`, {
          chat_id: session.chat_id,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }, { timeout: 10000 });
        sent = true;
      } catch (err: any) {
        log(`[NOTIFY] Telegram sendMessage chat_id=${session.chat_id}: ${err.message}`, 'notify', 'warn');
      }
    }
    return sent;
  } catch (err: any) {
    log(`[NOTIFY] Не удалось прочитать telegram_sessions: ${err.message}`, 'notify', 'warn');
    return false;
  }
}

async function tryEmail(
  userId: string,
  letter: NonNullable<UserNotification['email']>,
  adminToken: string,
  directusUrl: string,
): Promise<boolean> {
  try {
    const response = await axios.get(`${directusUrl}/users/${userId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { fields: 'email,first_name' },
      timeout: 10000,
    });
    const email: string | undefined = response.data?.data?.email;
    if (!email) {
      log(`[NOTIFY] Email пользователя ${userId} не найден`, 'notify', 'warn');
      return false;
    }

    const result = await sendEmail({
      to: email,
      subject: letter.subject,
      html: letter.html,
      text: letter.text,
    });
    if (!result.ok) {
      log(`[NOTIFY] Не удалось отправить email на ${email}: ${result.error}`, 'notify', 'warn');
    }
    return result.ok === true;
  } catch (err: any) {
    log(`[NOTIFY] Ошибка отправки email: ${err.message}`, 'notify', 'warn');
    return false;
  }
}

/**
 * Доставляет уведомление пользователю. Никогда не бросает: уведомление — не та вещь,
 * ради которой стоит ронять фоновый цикл.
 *
 * Возвращает канал, по которому ушло сообщение, или 'none'.
 */
export async function notifyUser(notification: UserNotification): Promise<NotifyChannel> {
  if (!notification.userId) return 'none';

  const config = getDirectusConfig();
  if (!config) {
    log('[NOTIFY] Нет DIRECTUS_URL/admin-токена, уведомление пропущено', 'notify', 'warn');
    return 'none';
  }

  const { adminToken, directusUrl } = config;

  const viaTelegram = await tryTelegram(notification.userId, notification.telegramText, adminToken, directusUrl);
  if (viaTelegram) return 'telegram';

  if (notification.email) {
    const viaEmail = await tryEmail(notification.userId, notification.email, adminToken, directusUrl);
    if (viaEmail) return 'email';
  }

  return 'none';
}
