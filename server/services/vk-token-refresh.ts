import axios from 'axios';
import crypto from 'crypto';
import { log } from '../utils/logger';
import { sendEmail } from './email';

/**
 * Выставляет authExpired=true для VK в настройках кампании.
 * Вызывается при permanentFailure (refresh_token невалиден).
 */
export async function markVkAuthExpired(campaignId: string): Promise<void> {
  try {
    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    const directusUrl = process.env.DIRECTUS_URL;
    if (!adminToken || !directusUrl) return;

    const resp = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const campaignData = resp.data.data;
    const existing = campaignData.social_media_settings || {};
    const existingVk = existing.vk || {};

    // Если authExpired уже стоит — не шлём повторное уведомление
    if (existingVk.authExpired === true) {
      log(`[VK-REFRESH] authExpired уже выставлен для кампании ${campaignId} — повторное уведомление не отправляем`, 'vk-refresh');
      return;
    }

    await axios.patch(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      social_media_settings: {
        ...existing,
        vk: { ...existingVk, authExpired: true }
      }
    }, { headers: { Authorization: `Bearer ${adminToken}` } });

    log(`[VK-REFRESH] authExpired=true выставлен для кампании ${campaignId}`, 'vk-refresh');

    // Уведомляем владельца кампании (не блокируем основной поток)
    sendVkExpiredNotification(campaignId, campaignData, adminToken, directusUrl).catch(err => {
      log(`[VK-REFRESH] Ошибка отправки уведомления для кампании ${campaignId}: ${err.message}`, 'vk-refresh', 'warn');
    });
  } catch (err: any) {
    log(`[VK-REFRESH] Ошибка при выставлении authExpired для кампании ${campaignId}: ${err.message}`, 'vk-refresh', 'warn');
  }
}

/**
 * Отправляет уведомление владельцу кампании о том, что VK-подключение устарело.
 * Сначала пытается отправить через Telegram (если у кампании настроен Telegram
 * или у пользователя есть бот-сессия), иначе — на email.
 */
async function sendVkExpiredNotification(
  campaignId: string,
  campaignData: Record<string, any>,
  adminToken: string,
  directusUrl: string
): Promise<void> {
  const userId: string | undefined = campaignData.user_id;
  if (!userId) {
    log(`[VK-NOTIFY] Нет user_id в кампании ${campaignId}, уведомление не отправлено`, 'vk-refresh', 'warn');
    return;
  }

  const campaignName: string = campaignData.title || campaignData.name || campaignId;
  const appUrl = (process.env.APP_URL || process.env.PUBLIC_URL || 'https://smm.omemo.tech').replace(/\/$/, '');
  const reconnectUrl = `${appUrl}/campaigns/${campaignId}/`;

  // Проверяем настройки Telegram кампании (наличие канала/бота в social_media_settings)
  const hasCampaignTelegram = !!(campaignData.social_media_settings?.telegram?.chatId ||
    campaignData.social_media_settings?.telegram?.token);

  const telegramSent = await tryNotifyViaTelegram(
    userId, campaignName, reconnectUrl, adminToken, directusUrl, hasCampaignTelegram
  );
  if (telegramSent) return;

  await tryNotifyViaEmail(userId, campaignName, reconnectUrl, adminToken, directusUrl);
}

async function tryNotifyViaTelegram(
  userId: string,
  campaignName: string,
  reconnectUrl: string,
  adminToken: string,
  directusUrl: string,
  hasCampaignTelegram: boolean = false
): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const sessResp = await axios.get(`${directusUrl}/items/telegram_sessions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { 'filter[user_id][_eq]': userId, limit: 10 }
    });
    const sessions: Array<{ chat_id: number }> = sessResp.data.data || [];
    // Отправляем только если у кампании есть Telegram-настройки
    // или пользователь зарегистрирован в боте (есть сессия)
    if (sessions.length === 0 && !hasCampaignTelegram) return false;
    if (sessions.length === 0) return false;

    const text =
      `⚠️ <b>VK-подключение устарело</b>\n\n` +
      `Токен VK для кампании <b>${escapeHtml(campaignName)}</b> стал недействительным. ` +
      `Запланированные публикации во ВКонтакте не будут выходить до переподключения.\n\n` +
      `<a href="${reconnectUrl}">🔗 Переподключить VK</a>`;

    const apiBase = `https://api.telegram.org/bot${botToken}`;
    let sent = false;
    for (const session of sessions) {
      try {
        await axios.post(`${apiBase}/sendMessage`, {
          chat_id: session.chat_id,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        log(`[VK-NOTIFY] Telegram-уведомление отправлено chat_id=${session.chat_id}`, 'vk-refresh');
        sent = true;
      } catch (e: any) {
        log(`[VK-NOTIFY] Ошибка Telegram sendMessage chat_id=${session.chat_id}: ${e.message}`, 'vk-refresh', 'warn');
      }
    }
    return sent;
  } catch (err: any) {
    log(`[VK-NOTIFY] Ошибка запроса telegram_sessions: ${err.message}`, 'vk-refresh', 'warn');
    return false;
  }
}

async function tryNotifyViaEmail(
  userId: string,
  campaignName: string,
  reconnectUrl: string,
  adminToken: string,
  directusUrl: string
): Promise<void> {
  try {
    const userResp = await axios.get(`${directusUrl}/users/${userId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { fields: 'email,first_name' }
    });
    const userData = userResp.data.data;
    const email: string | undefined = userData?.email;
    if (!email) {
      log(`[VK-NOTIFY] Email пользователя ${userId} не найден`, 'vk-refresh', 'warn');
      return;
    }

    const firstName: string = userData.first_name || '';
    const greeting = firstName ? `Привет, ${firstName}!` : 'Привет!';

    const result = await sendEmail({
      to: email,
      subject: 'Требуется переподключение VK — SMM Manager',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="color:#e53e3e">⚠️ VK-подключение устарело</h2>
          <p>${greeting}</p>
          <p>Токен ВКонтакте для кампании <strong>${escapeHtml(campaignName)}</strong> стал недействительным.
          Запланированные публикации во ВКонтакте не будут выходить до тех пор, пока вы не переподключите аккаунт.</p>
          <p style="margin-top:24px">
            <a href="${reconnectUrl}"
               style="display:inline-block;padding:12px 28px;background:#0077ff;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">
              🔗 Переподключить VK
            </a>
          </p>
          <p style="margin-top:24px;color:#666;font-size:13px">
            Или перейдите по ссылке: <a href="${reconnectUrl}">${reconnectUrl}</a>
          </p>
        </div>
      `,
      text: `VK-подключение для кампании "${campaignName}" устарело. Переподключите аккаунт: ${reconnectUrl}`,
    });
    if (result.ok) {
      log(`[VK-NOTIFY] Email-уведомление отправлено на ${email}`, 'vk-refresh');
    } else {
      log(`[VK-NOTIFY] Не удалось отправить email на ${email}: ${result.error}`, 'vk-refresh', 'warn');
    }
  } catch (err: any) {
    log(`[VK-NOTIFY] Ошибка отправки email: ${err.message}`, 'vk-refresh', 'warn');
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Фоновое задание: обновляет токены всех кампаний, у которых tokenExpiresAt < now+26h
 * или нет tokenExpiresAt, но есть refreshToken.
 * Запускается каждые 6 часов через setInterval в server/index.ts.
 */
export async function refreshAllExpiringVkTokens(): Promise<void> {
  log('[VK-CRON] Запуск фонового обновления истекающих VK токенов...', 'vk-refresh');
  try {
    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    const directusUrl = process.env.DIRECTUS_URL;
    if (!adminToken || !directusUrl) {
      log('[VK-CRON] Нет adminToken или directusUrl, пропуск', 'vk-refresh', 'warn');
      return;
    }

    // Получаем все кампании с настройками — постранично
    let page = 1;
    const limit = 100;
    let processed = 0;
    let refreshed = 0;
    let failed = 0;

    while (true) {
      const resp = await axios.get(`${directusUrl}/items/user_campaigns`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        params: { fields: 'id,social_media_settings', limit, page, filter: { 'social_media_settings': { '_nnull': true } } }
      });
      const campaigns: Array<{ id: string; social_media_settings: any }> = resp.data.data || [];
      if (campaigns.length === 0) break;

      // Рефрешим только если токен истекает в ближайшие 4 часа.
      // VK ID v2 токены живут 24 часа — порог 26h был слишком агрессивным
      // и вызывал лишние рефреши на каждом запуске кроп.
      const threshold = Date.now() + 4 * 60 * 60 * 1000; // now + 4 часа
      // Не рефрешим если последний успешный refresh был менее 1 часа назад
      // (защита от гонки кроп ↔ проактивный refresh при публикации)
      const minRefreshIntervalMs = 60 * 60 * 1000; // 1 час

      const toRefresh = campaigns.filter(c => {
        const vk = c.social_media_settings?.vk;
        if (!vk?.refreshToken || !vk?.clientId) return false;
        if (vk.authExpired) return false;
        // Если обновляли менее часа назад — пропускаем (дать вкервер VK остыть)
        if (vk.tokenRefreshedAt) {
          const lastRefresh = new Date(vk.tokenRefreshedAt).getTime();
          if (Date.now() - lastRefresh < minRefreshIntervalMs) return false;
        }
        if (!vk.tokenExpiresAt) return true; // нет даты — обновляем на всякий случай
        return new Date(vk.tokenExpiresAt).getTime() < threshold;
      });

      log(`[VK-CRON] Страница ${page}: кампаний=${campaigns.length}, к обновлению=${toRefresh.length}`, 'vk-refresh');

      await Promise.all(toRefresh.map(async (c) => {
        processed++;
        const vk = c.social_media_settings.vk;
        try {
          const newToken = await refreshAndSaveVkToken(c.id, {
            refreshToken: vk.refreshToken,
            clientId: vk.clientId,
            deviceId: vk.deviceId
          });
          if (newToken) {
            refreshed++;
            log(`[VK-CRON] Обновлён токен для кампании ${c.id}`, 'vk-refresh');
          } else {
            log(`[VK-CRON] refresh вернул null для кампании ${c.id} (временная ошибка)`, 'vk-refresh', 'warn');
          }
        } catch (err: any) {
          failed++;
          if (err.permanentFailure) {
            log(`[VK-CRON] permanentFailure для кампании ${c.id}: ${err.message} — ставим authExpired`, 'vk-refresh', 'error');
            await markVkAuthExpired(c.id);
          } else {
            log(`[VK-CRON] Ошибка обновления токена для кампании ${c.id}: ${err.message}`, 'vk-refresh', 'error');
          }
        }
      }));

      if (campaigns.length < limit) break;
      page++;
    }

    log(`[VK-CRON] Завершено: обработано=${processed}, обновлено=${refreshed}, ошибок=${failed}`, 'vk-refresh');
  } catch (err: any) {
    log(`[VK-CRON] Критическая ошибка: ${err.message}`, 'vk-refresh', 'error');
  }
}

export interface VkRefreshResult {
  accessToken: string;
  refreshToken: string;
  deviceId?: string;
  expiresIn?: number;
}

// Коды ошибок OAuth2, при которых refresh_token точно невалиден
// и переподключение обязательно (не временный сбой).
const PERMANENT_OAUTH_ERRORS = ['invalid_grant', 'invalid_token', 'unauthorized', 'access_denied'];

/**
 * Обновляет VK ID OAuth2 v2 токен через refresh_token.
 * Возвращает:
 *   - VkRefreshResult при успехе
 *   - null — временная ошибка (сеть, таймаут, сервер VK недоступен) — можно ретраить
 *   - throws Error с .permanentFailure=true — токен точно невалиден, нужно переподключение
 */
export async function refreshVkToken(settings: {
  refreshToken: string;
  clientId: string;
  deviceId?: string;
}): Promise<VkRefreshResult | null> {
  try {
    const params = new URLSearchParams();
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', settings.refreshToken);
    params.set('client_id', settings.clientId);
    if (settings.deviceId) params.set('device_id', settings.deviceId);
    params.set('state', `refresh_${crypto.randomBytes(8).toString('hex')}`);
    log(`[VK-REFRESH] Запрос refresh: client_id=${settings.clientId} device_id=${settings.deviceId || 'НЕТ'} refresh_token_prefix=${settings.refreshToken.substring(0, 10)}...`, 'vk-refresh');

    const resp = await axios.post('https://id.vk.com/oauth2/auth', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 12000
    });

    const d = resp.data;

    // VK вернул OAuth-ошибку в теле с HTTP 200 (бывает)
    if (d.error && PERMANENT_OAUTH_ERRORS.includes(d.error)) {
      log(`[VK-REFRESH] Постоянная OAuth-ошибка: ${d.error} — ${d.error_description || ''}`, 'vk-refresh', 'error');
      const err = new Error(`VK OAuth error: ${d.error} — ${d.error_description || ''}`);
      (err as any).permanentFailure = true;
      throw err;
    }

    if (!d.access_token) {
      log(`[VK-REFRESH] Нет access_token в ответе: ${JSON.stringify(d)}`, 'vk-refresh', 'error');
      return null;
    }

    if (!d.refresh_token) {
      log(`[VK-REFRESH] ⚠️ VK не вернул новый refresh_token — сохраняем старый. Это нормально, но следите за этим.`, 'vk-refresh', 'warn');
    }

    log(`[VK-REFRESH] Токен успешно обновлён. refresh_token обновлён: ${!!d.refresh_token}, expires_in=${d.expires_in}`, 'vk-refresh');
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token || settings.refreshToken,
      deviceId: d.device_id || settings.deviceId,
      expiresIn: d.expires_in
    };
  } catch (err: any) {
    // Перебрасываем постоянные ошибки наверх
    if (err.permanentFailure) throw err;

    // HTTP 400/401 с OAuth-ошибкой в теле — тоже постоянная
    const errData = err.response?.data;
    if (errData?.error && PERMANENT_OAUTH_ERRORS.includes(errData.error)) {
      log(`[VK-REFRESH] Постоянная OAuth-ошибка (HTTP ${err.response?.status}): ${errData.error} — ${errData.error_description || ''}`, 'vk-refresh', 'error');
      const permanent = new Error(`VK OAuth error: ${errData.error} — ${errData.error_description || ''}`);
      (permanent as any).permanentFailure = true;
      throw permanent;
    }

    const msg = errData ? JSON.stringify(errData) : err.message;
    log(`[VK-REFRESH] Временная ошибка (retry возможен): ${msg}`, 'vk-refresh', 'warn');
    return null;
  }
}

/**
 * Per-campaign lock: предотвращает одновременный refresh одного токена
 * из разных потоков (кроп + публикация).
 * Если refresh уже идёт — ожидаем его результата вместо нового запроса к VK.
 */
const _refreshLocks = new Map<string, Promise<string | null>>();

/**
 * Обновляет токен и сохраняет обратно в настройки кампании.
 * Возвращает новый access_token или null при неудаче.
 * Потокобезопасно: параллельные вызовы для одной кампании ждут одного результата.
 */
export async function refreshAndSaveVkToken(
  campaignId: string,
  currentSettings: Record<string, any>
): Promise<string | null> {
  const existing = _refreshLocks.get(campaignId);
  if (existing) {
    log(`[VK-REFRESH] Refresh для кампании ${campaignId} уже выполняется — ожидаем результата`, 'vk-refresh');
    return existing;
  }

  const promise = _doRefreshAndSave(campaignId, currentSettings);
  _refreshLocks.set(campaignId, promise);
  try {
    return await promise;
  } finally {
    _refreshLocks.delete(campaignId);
  }
}

async function _doRefreshAndSave(
  campaignId: string,
  currentSettings: Record<string, any>
): Promise<string | null> {
  const { refreshToken, clientId, deviceId } = currentSettings;

  if (!refreshToken) {
    log(`[VK-REFRESH] Пропуск для кампании ${campaignId}: нет refreshToken`, 'vk-refresh', 'warn');
    return null;
  }
  if (!clientId) {
    log(`[VK-REFRESH] Пропуск для кампании ${campaignId}: нет clientId`, 'vk-refresh', 'warn');
    return null;
  }

  // Пробрасываем permanentFailure наверх — вызывающий код решит ставить ли authExpired.
  // Временные ошибки (null) просто возвращаем — можно ретраить.
  const result = await refreshVkToken({ refreshToken, clientId, deviceId });
  if (!result) return null;

  try {
    const axios2 = (await import('axios')).default;
    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    const directusUrl = process.env.DIRECTUS_URL;

    const campaignResp = await axios2.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const existing = campaignResp.data.data.social_media_settings || {};
    const existingVk = existing.vk || {};

    // tokenExpiresAt: если VK вернул expires_in — вычисляем новую дату.
    // Если не вернул — сохраняем старое значение (не обнуляем).
    const tokenExpiresAt = result.expiresIn
      ? new Date(Date.now() + result.expiresIn * 1000).toISOString()
      : (existingVk.tokenExpiresAt || null);

    const updatedVk = {
      ...existingVk,
      token: result.accessToken,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,          // новый refresh_token от VK
      deviceId: result.deviceId || deviceId,      // новый device_id от VK
      clientId: clientId,                         // явно сохраняем clientId
      tokenExpiresAt,
      tokenRefreshedAt: new Date().toISOString(), // маркер последнего успешного рефреша
      authExpired: false,                         // сбрасываем флаг "требует переподключения"
    };

    await axios2.patch(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      social_media_settings: {
        ...existing,
        vk: updatedVk
      }
    }, { headers: { Authorization: `Bearer ${adminToken}` } });

    log(
      `[VK-REFRESH] Сохранено в кампанию ${campaignId}: ` +
      `accessToken=...${result.accessToken.slice(-6)}, ` +
      `refreshToken=...${result.refreshToken.slice(-6)}, ` +
      `deviceId=${updatedVk.deviceId || 'нет'}, ` +
      `clientId=${clientId}, ` +
      `tokenExpiresAt=${tokenExpiresAt}`,
      'vk-refresh'
    );
    return result.accessToken;
  } catch (err: any) {
    log(`[VK-REFRESH] Ошибка сохранения токена: ${err.message}`, 'vk-refresh', 'error');
    return result.accessToken;
  }
}
