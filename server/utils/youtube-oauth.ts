import { google } from 'googleapis';
import { YouTubeConfig } from '../services/global-api-keys';

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
    console.log('[getDefaultRedirectUri] Начинаем определение redirect URI');
    console.log('[getDefaultRedirectUri] SMM_DOMAIN:', process.env.SMM_DOMAIN || 'НЕ ЗАДАН');
    console.log('[getDefaultRedirectUri] YOUTUBE_REDIRECT_URI:', process.env.YOUTUBE_REDIRECT_URI || 'НЕ ЗАДАН');
    console.log('[getDefaultRedirectUri] DIRECTUS_URL:', process.env.DIRECTUS_URL || 'НЕ ЗАДАН');
    console.log('[getDefaultRedirectUri] VITE_DIRECTUS_URL:', process.env.VITE_DIRECTUS_URL || 'НЕ ЗАДАН');
    console.log('[getDefaultRedirectUri] REPL_ID:', process.env.REPL_ID || 'НЕ ЗАДАН');
    console.log('[getDefaultRedirectUri] NODE_ENV:', process.env.NODE_ENV || 'НЕ ЗАДАН');
    
    // ПРИОРИТЕТ 0: SMM_DOMAIN - явно заданный домен для production
    const smmDomain = process.env.SMM_DOMAIN;
    if (smmDomain) {
      console.log('[getDefaultRedirectUri] Используем SMM_DOMAIN:', smmDomain);
      return `https://${smmDomain}/api/youtube/auth/callback`;
    }
    
    // ПРИОРИТЕТ 1: Replit среда - используем REPLIT_DEV_DOMAIN (если есть, значит работаем на Replit)
    const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
    if (replitDevDomain) {
      const replUrl = `https://${replitDevDomain}`;
      console.log('[getDefaultRedirectUri] Определена REPLIT среда (REPLIT_DEV_DOMAIN найден):');
      console.log('[getDefaultRedirectUri] REPLIT_DEV_DOMAIN:', replitDevDomain);
      console.log('[getDefaultRedirectUri] Полный URL:', replUrl);
      
      return `${replUrl}/api/youtube/auth/callback`;
    }
    
    // ПРИОРИТЕТ 2: Определяем продакшен/стейдж по домену Directus
    const directusUrl = process.env.DIRECTUS_URL || process.env.VITE_DIRECTUS_URL;
    console.log('[getDefaultRedirectUri] directusUrl для проверки:', directusUrl);
    
    if (directusUrl?.includes('omemo.tech')) {
      // Продакшен среда (omemo.tech домен)
      console.log('[getDefaultRedirectUri] Определена ПРОДАКШЕН среда (omemo.tech)');
      return 'https://smm.omemo.tech/api/youtube/auth/callback';
    }
    
    if (directusUrl?.includes('nplanner.ru')) {
      // Продакшен среда (nplanner.ru домен)
      console.log('[getDefaultRedirectUri] Определена ПРОДАКШЕН среда (nplanner.ru)');
      return `https://smm.${process.env.DOMAIN_NAME || 'omemo.tech'}/api/youtube/auth/callback`;
    }
    
    // Если URL Directus содержит nplanner.ru, значит мы в продакшене
    if (directusUrl?.includes('nplanner.ru')) {
      return 'https://smm.omemo.tech/api/youtube/auth/callback';
    }
    
    if (directusUrl?.includes('roboflow.space')) {
      // Стейдж среда (roboflow.space домен)
      console.log('[getDefaultRedirectUri] Определена СТЕЙДЖ среда (roboflow.space)');
      return 'https://smm.roboflow.space/api/youtube/auth/callback';
    }
    
    // ПРИОРИТЕТ 3: Если есть устаревший YOUTUBE_REDIRECT_URI, игнорируем только если он от Replit
    if (process.env.YOUTUBE_REDIRECT_URI && !process.env.YOUTUBE_REDIRECT_URI.includes('replit.dev')) {
      console.log('[getDefaultRedirectUri] Используем YOUTUBE_REDIRECT_URI (не replit):', process.env.YOUTUBE_REDIRECT_URI);
      return process.env.YOUTUBE_REDIRECT_URI;
    }
    
    if (process.env.YOUTUBE_REDIRECT_URI) {
      console.log('[getDefaultRedirectUri] Игнорируем устаревший YOUTUBE_REDIRECT_URI от replit.dev');
    }
    
    // Fallback для локальной разработки
    console.log('[getDefaultRedirectUri] Используем localhost fallback');
    return 'http://localhost:5000/api/youtube/auth/callback';
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