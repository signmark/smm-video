/**
 * TikTok OAuth 2.0 Helper
 * Documentation: https://developers.tiktok.com/doc/login-kit-web
 */

import axios from 'axios';
import { oauthRedirectUri } from './public-url';
import { log } from './logger';

export interface TikTokConfig {
  clientKey: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  openId: string;
  scope: string;
}

export interface TikTokCreatorInfo {
  creatorAvatarUrl: string;
  creatorNickname: string;
  creatorUsername: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

export class TikTokOAuth {
  private clientKey: string;
  private clientSecret: string;
  private redirectUri: string;

  private static readonly AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
  private static readonly TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
  private static readonly CREATOR_INFO_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';

  constructor(config: TikTokConfig) {
    this.clientKey = config.clientKey;
    this.clientSecret = config.clientSecret;
    this.redirectUri = config.redirectUri || this.getDefaultRedirectUri();

    log('[tiktok-oauth] Конфигурация TikTok OAuth:');
    log('[tiktok-oauth] - clientKey:', this.clientKey ? '***установлен***' : 'НЕ ЗАДАН');
    log('[tiktok-oauth] - clientSecret:', this.clientSecret ? '***установлен***' : 'НЕ ЗАДАН');
    log('[tiktok-oauth] - redirectUri:', this.redirectUri);
  }

  private getDefaultRedirectUri(): string {
    // Было: угадывание домена по подстроке в DIRECTUS_URL, причём ветка
    // nplanner.ru дублировалась и вторая копия была недостижима. Теперь адрес
    // берётся из APP_PUBLIC_URL, см. server/utils/public-url.ts.
    return oauthRedirectUri('/api/tiktok/auth/callback');
  }

  /**
   * Генерирует URL для авторизации пользователя
   */
  getAuthUrl(state: string): string {
    const scopes = [
      'user.info.basic',
      'video.upload',
      'video.publish'
    ];

    // Build URL manually — URLSearchParams encodes commas as %2C which TikTok rejects
    const params = new URLSearchParams({
      client_key: this.clientKey,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      state: state
    });

    // Append scope with raw commas (not %2C) as TikTok Login Kit requires
    return `${TikTokOAuth.AUTH_URL}?${params.toString()}&scope=${scopes.join(',')}`;
  }

  /**
   * Обменивает authorization code на access token
   */
  async exchangeCodeForTokens(code: string): Promise<TikTokTokens> {
    const response = await axios.post(
      TikTokOAuth.TOKEN_URL,
      new URLSearchParams({
        client_key: this.clientKey,
        client_secret: this.clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const data = response.data;

    if (data.error) {
      throw new Error(`TikTok OAuth error: ${data.error_description || data.error}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      openId: data.open_id,
      scope: data.scope
    };
  }

  /**
   * Обновляет access token используя refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<TikTokTokens> {
    const response = await axios.post(
      TikTokOAuth.TOKEN_URL,
      new URLSearchParams({
        client_key: this.clientKey,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const data = response.data;

    if (data.error) {
      throw new Error(`TikTok refresh error: ${data.error_description || data.error}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      openId: data.open_id,
      scope: data.scope
    };
  }

  /**
   * Получает информацию о создателе контента (требует video.publish scope)
   */
  async getCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
    const response = await axios.post(
      TikTokOAuth.CREATOR_INFO_URL,
      {},
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = response.data;

    if (data.error?.code !== 'ok') {
      throw new Error(`TikTok creator info error: ${data.error?.message || 'Unknown error'}`);
    }

    const creatorInfo = data.data;

    return {
      creatorAvatarUrl: creatorInfo.creator_avatar_url,
      creatorNickname: creatorInfo.creator_nickname,
      creatorUsername: creatorInfo.creator_username,
      privacyLevelOptions: creatorInfo.privacy_level_options || ['SELF_ONLY'],
      commentDisabled: creatorInfo.comment_disabled || false,
      duetDisabled: creatorInfo.duet_disabled || false,
      stitchDisabled: creatorInfo.stitch_disabled || false,
      maxVideoPostDurationSec: creatorInfo.max_video_post_duration_sec || 60
    };
  }

  /**
   * Получает базовую информацию о пользователе (требует только user.info.basic scope)
   */
  async getUserBasicInfo(accessToken: string): Promise<{ displayName: string; avatarUrl: string; unionId: string }> {
    const response = await axios.get(
      'https://open.tiktokapis.com/v2/user/info/',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        params: {
          fields: 'display_name,avatar_url,union_id'
        }
      }
    );

    const data = response.data;

    if (data.error?.code !== 'ok') {
      throw new Error(`TikTok user info error: ${data.error?.message || 'Unknown error'}`);
    }

    const user = data.data?.user || {};
    return {
      displayName: user.display_name || 'TikTok User',
      avatarUrl: user.avatar_url || '',
      unionId: user.union_id || ''
    };
  }
}
