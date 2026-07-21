/**
 * Сервис для обновления YouTube OAuth токенов
 * Получает client_id/secret из global_api_keys (через GlobalApiKeysService) или env vars
 */
import axios from 'axios';
import { log } from '../utils/logger';

export interface YouTubeTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  expiresAt: number;
}

interface YouTubeClientConfig {
  clientId: string;
  clientSecret: string;
}

async function getYouTubeClientCredentials(): Promise<YouTubeClientConfig> {
  // Приоритет 1: YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET из env
  const envClientId = process.env.YOUTUBE_CLIENT_ID;
  const envClientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (envClientId && envClientSecret) {
    return { clientId: envClientId, clientSecret: envClientSecret };
  }

  // Приоритет 2: global_api_keys через GlobalApiKeysService (та же логика что в youtube-auth.ts)
  try {
    const { GlobalApiKeysService } = await import('./global-api-keys');
    const svc = new GlobalApiKeysService();
    const config = await svc.getYouTubeConfig();
    if (config?.clientId && config?.clientSecret) {
      return { clientId: config.clientId, clientSecret: config.clientSecret };
    }
  } catch (err: any) {
    log(`Не удалось загрузить YouTube конфиг из БД: ${err.message}`, 'youtube-auth');
  }

  // Приоритет 3: старые env vars для обратной совместимости
  const legacyId = process.env.GOOGLE_CLIENT_ID;
  const legacySecret = process.env.GOOGLE_CLIENT_SECRET;
  if (legacyId && legacySecret) {
    return { clientId: legacyId, clientSecret: legacySecret };
  }

  throw new Error('YOUTUBE_CLIENT_ID и YOUTUBE_CLIENT_SECRET не настроены ни в env, ни в базе данных');
}

export class YouTubeTokenRefresh {
  async refreshAccessToken(refreshToken: string): Promise<YouTubeTokens> {
    if (!refreshToken) {
      throw new Error('Refresh token не предоставлен');
    }

    const { clientId, clientSecret } = await getYouTubeClientCredentials();

    try {
      log(`Обновление YouTube access token через refresh token`, 'youtube-auth');

      const response = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const data = response.data;

      if (!data.access_token) {
        throw new Error('Google OAuth не вернул access_token. Ключи ответа: ' + Object.keys(data || {}).join(', '));
      }

      const expiresIn = data.expires_in || 3600;
      const expiresAt = Date.now() + expiresIn * 1000;

      log(`YouTube access token успешно обновлён, истекает через ${expiresIn}с`, 'youtube-auth');

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresIn,
        expiresAt
      };
    } catch (error: any) {
      const errData = error.response?.data;
      if (errData?.error) {
        log(`Ошибка обновления YouTube токена: ${errData.error} — ${errData.error_description}`, 'youtube-auth');
        if (errData.error === 'invalid_grant') {
          throw new Error('YouTube refresh token истёк или недействителен. Требуется повторная авторизация через настройки кампании.');
        }
      }
      log(`Ошибка при обновлении YouTube токена: ${error.message}`, 'youtube-auth');
      throw error;
    }
  }

  shouldRefreshToken(expiresAt: number): boolean {
    return expiresAt < Date.now() + 5 * 60 * 1000;
  }

  async refreshIfNeeded(currentTokens: { accessToken: string; refreshToken: string; expiresAt: number }): Promise<YouTubeTokens | null> {
    if (!this.shouldRefreshToken(currentTokens.expiresAt)) {
      return null;
    }
    log(`YouTube токен истекает, автоматическое обновление...`, 'youtube-auth');
    return await this.refreshAccessToken(currentTokens.refreshToken);
  }
}
