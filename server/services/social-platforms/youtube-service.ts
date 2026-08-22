import axios from 'axios';
import { trackExternalCall } from '../../utils/external-call';
import { log } from '../../utils/logger';
import { BaseSocialService, TokenValidationResult } from './base-service';

export class YouTubeService extends BaseSocialService {
  constructor() {
    super('youtube');
  }

  /**
   * Проверяет валидность Google/YouTube токена
   */
  async validateToken(settings: any): Promise<TokenValidationResult> {
    const token = settings.accessToken || settings.token;
    if (!token) return { isValid: false, error: 'Токен отсутствует' };

    try {
      // Проверяем токен через Google Token Info API
      const response = await trackExternalCall(
        'youtube',
        'token.validate',
        () => axios.get(`https://oauth2.googleapis.com/tokeninfo`, {
          params: { access_token: token }
        })
      );

      // Проверяем наличие нужных scope для YouTube
      const scope = response.data.scope || '';
      const hasYouTubeScope = scope.includes('youtube.upload') || scope.includes('youtube.readonly') || scope.includes('youtube');

      if (!hasYouTubeScope) {
        return { isValid: false, error: 'Отсутствуют права на YouTube (youtube.upload)' };
      }

      return { 
        isValid: true, 
        expiresAt: response.data.exp ? new Date(parseInt(response.data.exp) * 1000) : null 
      };
    } catch (error: any) {
      const msg = error.response?.data?.error_description || error.message;
      return { isValid: false, error: msg };
    }
  }

  async publishContent(
    content: any, 
    campaignSettings: any,
    userId: string
  ): Promise<{ success: boolean; postUrl?: string; error?: string; quotaExceeded?: boolean }> {
    try {
      log('youtube', `Начинаем публикацию в YouTube для контента ${content.id}`);
      log('youtube', `Content type: ${content.content_type}, video_url: ${content.video_url ? 'есть' : 'нет'}`);
      
      // Определяем, должно ли видео быть Shorts
      const isShort = content.content_type === 'clip';
      
      log('youtube', `Публикация как ${isShort ? 'YouTube Shorts' : 'обычное видео'}`);
      
      // Заголовок нужен только для журнала: сама загрузка идёт в планировщике
      const title = this.stripHtml(content.title || 'Video');
      log('youtube', `Публикация «${title}» делегирована планировщику`);
      
      // YouTube публикуется через publishToYouTubeDirect в publish-scheduler
      return {
        success: true,
        postUrl: undefined
      };

    } catch (error: any) {
      log('youtube', `Ошибка публикации в YouTube: ${error.message}`);
      
      // Обработка ошибок сети/таймаута
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        return {
          success: false,
          error: 'Таймаут при загрузке видео на YouTube. Попробуйте позже.'
        };
      }

      return {
        success: false,
        error: `Ошибка YouTube: ${error.message}`
      };
    }
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }
}
