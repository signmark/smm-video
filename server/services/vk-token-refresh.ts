import axios from 'axios';
import crypto from 'crypto';
import { log } from '../utils/logger';

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
 * Обновляет токен и сохраняет обратно в настройки кампании.
 * Возвращает новый access_token или null при неудаче.
 */
export async function refreshAndSaveVkToken(
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
