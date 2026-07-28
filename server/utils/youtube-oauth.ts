import { google } from 'googleapis';
import { YouTubeConfig } from '../services/global-api-keys';
import { oauthRedirectUri } from './public-url';

export class YouTubeOAuth {
  private oauth2Client: any;

  constructor(config?: YouTubeConfig) {
    // Если конфигурация передана, используем её
    if (config) {
      const defaultRedirectUri = this.getDefaultRedirectUri();
      const finalRedirectUri = config.redirectUri || defaultRedirectUri;
      
      console.log('[youtube-oauth] Конфигурация YouTube OAuth:');
      console.log('[youtube-oauth] - clientId:', config.clientId ? '***установлен***' : 'НЕ ЗАДАН');
      console.log('[youtube-oauth] - clientSecret:', config.clientSecret ? '***установлен***' : 'НЕ ЗАДАН');
      console.log('[youtube-oauth] - redirectUri из config:', config.redirectUri || 'НЕ ЗАДАН');
      console.log('[youtube-oauth] - getDefaultRedirectUri():', defaultRedirectUri);
      console.log('[youtube-oauth] - Финальный redirect URI:', finalRedirectUri);
      
      this.oauth2Client = new google.auth.OAuth2(
        config.clientId,
        config.clientSecret,
        finalRedirectUri
      );
    } else {
      // Fallback на старый способ с переменными среды
      const redirectUri = this.getDefaultRedirectUri();
      console.log('[youtube-oauth] Fallback: используем переменные среды и redirect URI:', redirectUri);
      
      this.oauth2Client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        redirectUri
      );
    }
  }

  private getDefaultRedirectUri(): string {
    // Раньше здесь окружение угадывалось по подстроке в DIRECTUS_URL
    // («если там omemo.tech — значит прод») с четырьмя ветками и мёртвым
    // дублем nplanner.ru. Теперь адрес берётся из APP_PUBLIC_URL, см.
    // server/utils/public-url.ts.

    // Явный YOUTUBE_REDIRECT_URI имеет приоритет: в консоли Google этот адрес
    // прописывается вручную и может не совпадать с публичным доменом.
    // Игнорируем только протухшие replit-адреса.
    const explicit = process.env.YOUTUBE_REDIRECT_URI;
    if (explicit && !explicit.includes('replit.dev')) {
      console.log('[getDefaultRedirectUri] Используем YOUTUBE_REDIRECT_URI:', explicit);
      return explicit;
    }
    if (explicit) {
      console.log('[getDefaultRedirectUri] Игнорируем устаревший YOUTUBE_REDIRECT_URI от replit.dev');
    }

    const uri = oauthRedirectUri('/api/youtube/auth/callback');
    console.log('[getDefaultRedirectUri] redirect URI из публичного домена:', uri);
    return uri;
  }

  getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.upload'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const { tokens } = await this.oauth2Client.getToken(code);
    
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token
    };
  }

  async getChannelInfo(accessToken: string): Promise<{
    channelId: string;
    channelTitle: string;
  }> {
    this.oauth2Client.setCredentials({
      access_token: accessToken
    });

    const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });
    
    const response = await youtube.channels.list({
      part: ['snippet'],
      mine: true
    });

    const channel = response.data.items?.[0];
    if (!channel) {
      throw new Error('Канал не найден');
    }

    return {
      channelId: channel.id!,
      channelTitle: channel.snippet?.title || 'Unknown Channel'
    };
  }
}