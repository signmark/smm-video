/**
 * YouTube Shorts Direct Publishing Service
 *
 * Прямая загрузка коротких видео как YouTube Shorts через YouTube Data API v3
 * без N8N, с поддержкой refresh token.
 */

import axios from 'axios';
import { log } from '../../utils/logger';
import { directusApi } from '../../directus';
import { YouTubeTokenRefresh } from '../youtube-token-refresh';

const LOG_PREFIX = 'youtube-shorts';

export interface YouTubeShortsPublishResult {
  success: boolean;
  videoId?: string;
  videoUrl?: string;
  error?: string;
}

interface YouTubeSettings {
  accessToken: string;
  refreshToken: string;
  channelId?: string;
}

export class YouTubeShortsService {
  private tokenRefresh = new YouTubeTokenRefresh();

  async publishShort(
    contentId: string,
    authToken?: string
  ): Promise<YouTubeShortsPublishResult> {
    try {
      log(`Начинаю публикацию YouTube Shorts для контента ${contentId}`, LOG_PREFIX);

      const token = authToken || process.env.DIRECTUS_ADMIN_TOKEN;

      const contentResponse = await directusApi.get(`/items/campaign_content/${contentId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const content = contentResponse.data.data;

      if (!content) return { success: false, error: 'Контент не найден' };
      if (!content.video_url) return { success: false, error: 'Видео URL не найден. YouTube Shorts требует видео.' };

      const ytSettings = await this.getYouTubeSettings(content.campaign_id, authToken);
      if (!ytSettings) {
        return { success: false, error: 'YouTube настройки не найдены в кампании. Подключите YouTube аккаунт.' };
      }

      let { accessToken } = ytSettings;

      // Обновляем токен если нужно (проверяем через tokeninfo)
      if (ytSettings.refreshToken) {
        try {
          const tokenInfo = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
            params: { access_token: accessToken }
          });
          const expiresIn = parseInt(tokenInfo.data.expires_in || '3600');
          if (expiresIn < 300) {
            log(`YouTube токен истекает через ${expiresIn}с, обновляю...`, LOG_PREFIX);
            const refreshed = await this.tokenRefresh.refreshAccessToken(ytSettings.refreshToken);
            accessToken = refreshed.accessToken;
          }
        } catch {
          // Токен невалиден — пробуем обновить
          try {
            log(`YouTube токен недействителен, обновляю через refresh token...`, LOG_PREFIX);
            const refreshed = await this.tokenRefresh.refreshAccessToken(ytSettings.refreshToken);
            accessToken = refreshed.accessToken;
          } catch (refreshErr: any) {
            return { success: false, error: `YouTube токен истёк, обновление не удалось: ${refreshErr.message}. Переподключите YouTube аккаунт.` };
          }
        }
      }

      log(`Скачиваю видео: ${content.video_url}`, LOG_PREFIX);
      const videoBuffer = await this.downloadVideo(content.video_url);

      const rawTitle = this.stripHtml(content.title || 'Видео');
      const title = (rawTitle + ' #Shorts').substring(0, 100);
      const description = this.stripHtml(content.content || '');

      log(`Загружаю в YouTube: "${title}" (${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB)`, LOG_PREFIX);
      const videoId = await this.uploadToYouTube(accessToken, videoBuffer, title, description);

      const videoUrl = `https://youtube.com/shorts/${videoId}`;
      log(`YouTube Shorts опубликован! ID: ${videoId}, URL: ${videoUrl}`, LOG_PREFIX);

      await this.updateContentStatus(contentId, videoId, videoUrl, authToken);

      return { success: true, videoId, videoUrl };

    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      log(`Ошибка публикации YouTube Shorts: ${errorMessage}`, LOG_PREFIX);
      console.error('[YOUTUBE-SHORTS] Error:', error);
      return { success: false, error: errorMessage };
    }
  }

  private async getYouTubeSettings(campaignId: string, authToken?: string): Promise<YouTubeSettings | null> {
    try {
      const token = authToken || process.env.DIRECTUS_ADMIN_TOKEN;
      const response = await directusApi.get(`/items/user_campaigns/${campaignId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const campaign = response.data.data;
      const ytSettings = campaign.social_settings?.youtube || campaign.social_media_settings?.youtube;

      if (!ytSettings?.accessToken && !ytSettings?.token) {
        log('YouTube настройки не найдены или отсутствует токен', LOG_PREFIX);
        return null;
      }

      return {
        accessToken: ytSettings.accessToken || ytSettings.token,
        refreshToken: ytSettings.refreshToken,
        channelId: ytSettings.channelId,
      };
    } catch (error) {
      log(`Ошибка получения настроек YouTube: ${error}`, LOG_PREFIX);
      return null;
    }
  }

  private async downloadVideo(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 180000,
      maxContentLength: 500 * 1024 * 1024,
    });
    return Buffer.from(response.data);
  }

  private async uploadToYouTube(
    accessToken: string,
    videoBuffer: Buffer,
    title: string,
    description: string
  ): Promise<string> {
    // Шаг 1: инициируем resumable upload
    const initResponse = await axios.post(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        snippet: {
          title,
          description: description.substring(0, 5000),
          categoryId: '22', // People & Blogs
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(videoBuffer.length),
        },
      }
    );

    const uploadUri = initResponse.headers['location'];
    if (!uploadUri) {
      throw new Error('YouTube не вернул upload URI. Проверьте права токена (scope: youtube.upload).');
    }

    log(`Resumable upload URI получен, загружаю ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB...`, LOG_PREFIX);

    // Шаг 2: загружаем видео
    const uploadResponse = await axios.put(uploadUri, videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(videoBuffer.length),
      },
      timeout: 600000, // 10 минут
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const videoId = uploadResponse.data?.id;
    if (!videoId) {
      throw new Error(`YouTube не вернул ID видео. Ответ: ${JSON.stringify(uploadResponse.data)}`);
    }

    return videoId;
  }

  private async updateContentStatus(
    contentId: string,
    videoId: string,
    videoUrl: string,
    authToken?: string
  ): Promise<void> {
    try {
      const token = authToken || process.env.DIRECTUS_ADMIN_TOKEN;
      const contentResponse = await directusApi.get(`/items/campaign_content/${contentId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const currentSocialPlatforms = contentResponse.data.data?.social_platforms || {};

      await directusApi.patch(`/items/campaign_content/${contentId}`, {
        social_platforms: {
          ...currentSocialPlatforms,
          youtube: {
            postId: videoId,
            status: 'published',
            postUrl: videoUrl,
            platform: 'youtube',
            publishedAt: new Date().toISOString(),
            type: 'shorts',
          },
        },
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      log(`Статус YouTube Shorts обновлён в Directus`, LOG_PREFIX);
    } catch (error) {
      log(`Ошибка обновления статуса YouTube: ${error}`, LOG_PREFIX);
    }
  }

  private stripHtml(html: string): string {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

export const youtubeShortsService = new YouTubeShortsService();
