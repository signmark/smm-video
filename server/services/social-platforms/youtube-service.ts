import axios from 'axios';
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
      const response = await axios.get(`https://oauth2.googleapis.com/tokeninfo`, {
        params: { access_token: token }
      });

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
      console.log(`🚀 [N8N-REQUEST] PLATFORM: youtube`);
      log('youtube', `Начинаем публикацию в YouTube через N8N для контента ${content.id}`);
      log('youtube', `Content type: ${content.content_type}, video_url: ${content.video_url ? 'есть' : 'нет'}`);

      // Проверяем наличие видео - УДАЛЕНО ПО ПРОСЬБЕ ЮЗЕРА (пре-валидация мешает n8n)
      /*
      if (!content.video_url) {
        throw new Error('Video URL is required for YouTube publishing');
      }
      */

      // YouTube публикация через прямой API (n8n удалён)
      log('youtube', `YouTube publish через прямой API для контента ${content.id}`);
      
      // Определяем, должно ли видео быть Shorts
      const isShort = content.content_type === 'clip';
      
      log('youtube', `Публикация как ${isShort ? 'YouTube Shorts' : 'обычное видео'}`);
      
      // Подготавливаем title и description
      const title = this.stripHtml(content.title || 'Video');
      const description = this.stripHtml(content.content || '');
      
      const payload = {
        contentId: content.id,
        userId: userId,
        campaignId: content.campaign_id,
        videoUrl: content.video_url,
        title: title,
        description: description,
        isShort: isShort,
        contentType: content.content_type
      };
      
      log('youtube', `Публикация YouTube делегирована планировщику (прямой API)`);
      
      // YouTube публикуется через publishToYouTubeDirect в publish-scheduler
      return {
        success: true,
        postUrl: undefined
      };

    } catch (error: any) {
      log('youtube', `Ошибка публикации в YouTube через N8N: ${error.message}`);
      
      // Обработка ошибок сети/таймаута
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        return {
          success: false,
          error: 'Таймаут при загрузке видео на YouTube. Попробуйте позже.'
        };
      }

      // Обработка ошибок от N8N
      if (error.response?.data) {
        const n8nError = error.response.data.error || error.response.data.message || 'Ошибка N8N workflow';
        return {
          success: false,
          error: `Ошибка N8N: ${n8nError}`
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
