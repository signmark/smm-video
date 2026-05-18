import axios from 'axios';
import crypto from 'crypto';
import { log } from '../utils/logger';

export interface VkRefreshResult {
  accessToken: string;
  refreshToken: string;
  deviceId?: string;
  expiresIn?: number;
}

/**
 * Обновляет VK ID OAuth2 v2 токен через refresh_token.
 * Возвращает null при любой ошибке (в т.ч. если refresh_token тоже протух).
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
    if (!d.access_token) {
      log(`[VK-REFRESH] Нет access_token в ответе: ${JSON.stringify(d)}`, 'vk-refresh', 'error');
      return null;
    }

    log(`[VK-REFRESH] Токен успешно обновлён. Новый refresh_token получен: ${!!d.refresh_token}, expires_in=${d.expires_in}`, 'vk-refresh');
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token || settings.refreshToken,
      deviceId: d.device_id || settings.deviceId,
      expiresIn: d.expires_in
    };
  } catch (err: any) {
    const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    log(`[VK-REFRESH] Ошибка обновления токена: ${msg}`, 'vk-refresh', 'error');
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
