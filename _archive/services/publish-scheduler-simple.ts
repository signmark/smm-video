import axios from 'axios';
import { log } from '../utils/logger';
import { directusApiManager } from '../directus';
import { publicationLockManager } from './publication-lock-manager';
import { YouTubeService } from './social-platforms/youtube-service';
import { VKClipsService } from './social-platforms/vk-clips-service';

const youtubeService = new YouTubeService();
const vkClipsService = new VKClipsService();

const CLIPS_CONTENT_TYPES = ['clip', 'shorts', 'video_story', 'short_video', 'video_clip'];

/**
 * Упрощенный планировщик для отправки webhooks в N8N
 * Все публикации и обновления статусов выполняет N8N
 */
export class PublishScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkIntervalMs = 30000; // проверяем каждые 30 секунд
  private isProcessing = false;
  
  // Кэш токенов
  private adminTokenCache: string | null = null;
  private adminTokenTimestamp: number = 0;
  private tokenExpirationMs = 30 * 60 * 1000; // 30 минут

  /**
   * Запускает планировщик публикаций
   */
  start() {
    if (this.isRunning) {
      log('⚠️ Планировщик уже запущен', 'scheduler');
      return;
    }

    this.isRunning = true;
    log('✅ Запуск N8N планировщика публикаций', 'scheduler');
    
    // Сразу выполняем первую проверку
    this.checkScheduledContent();
    
    // Устанавливаем интервал для регулярной проверки
    this.intervalId = setInterval(() => {
      this.checkScheduledContent();
    }, this.checkIntervalMs);
    
    log(`✅ N8N планировщик запущен с интервалом ${this.checkIntervalMs}мс`, 'scheduler');
  }

  /**
   * Останавливает планировщик публикаций
   */
  stop() {
    if (!this.isRunning || !this.intervalId) {
      log('Планировщик не запущен', 'scheduler');
      return;
    }

    log('Остановка N8N планировщика', 'scheduler');
    clearInterval(this.intervalId);
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Проверяет запланированный контент и отправляет webhooks в N8N
   */
  private async checkScheduledContent() {
    if (this.isProcessing) {
      log('Предыдущая проверка еще выполняется, пропускаем', 'scheduler');
      return;
    }

    this.isProcessing = true;

    try {
      const token = await this.getAdminToken();
      if (!token) {
        log('❌ Не удалось получить токен администратора', 'scheduler');
        return;
      }

      // Получаем запланированный контент
      const scheduledContent = await this.getScheduledContent(token);
      log(`Найдено ${scheduledContent.length} запланированных элементов контента`, 'scheduler');

      for (const content of scheduledContent) {
        await this.processScheduledContent(content);
      }

    } catch (error: any) {
      log(`❌ Ошибка при проверке запланированного контента: ${error.message}`, 'scheduler');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Получает токен администратора
   */
  private async getAdminToken(): Promise<string | null> {
    const now = Date.now();
    
    // Проверяем кэш токена
    if (this.adminTokenCache && (now - this.adminTokenTimestamp) < this.tokenExpirationMs) {
      return this.adminTokenCache;
    }

    try {
      const token = await directusApiManager.getAdminToken();
      this.adminTokenCache = token;
      this.adminTokenTimestamp = now;
      log('Токен авторизации для планировщика получен', 'scheduler');
      return token;
    } catch (error: any) {
      log(`❌ Ошибка получения токена: ${error.message}`, 'scheduler');
      return null;
    }
  }

  /**
   * Получает запланированный контент из Directus
   */
  private async getScheduledContent(token: string): Promise<any[]> {
    try {
      const now = new Date();
      const filter = {
        status: { _eq: 'scheduled' },
        scheduled_at: { _lte: now.toISOString() }
      };

      const response = await axios.get(`${process.env.DIRECTUS_URL}/items/campaign_content`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          filter: JSON.stringify(filter),
          fields: 'id,social_platforms,campaign_id,content_type,video_url,title,content,keywords'
        }
      });

      return response.data.data || [];
    } catch (error: any) {
      log(`❌ Ошибка получения запланированного контента: ${error.message}`, 'scheduler');
      return [];
    }
  }

  /**
   * Обрабатывает запланированный контент - отправляет webhooks в N8N или использует прямую публикацию
   */
  private async processScheduledContent(content: any) {
    try {
      const { id: contentId, social_platforms, content_type } = content;
      
      if (!social_platforms) {
        log(`Контент ${contentId}: нет настроек платформ`, 'scheduler');
        return;
      }

      const readyPlatforms = this.getReadyPlatforms(social_platforms);
      
      if (readyPlatforms.length === 0) {
        log(`Контент ${contentId}: нет готовых платформ для публикации`, 'scheduler');
        return;
      }

      const isClipsContent = content_type && CLIPS_CONTENT_TYPES.includes(content_type);
      
      if (isClipsContent) {
        log(`Контент ${contentId} (${content_type}): обработка clips/shorts для: ${readyPlatforms.join(', ')}`, 'scheduler');
        for (const platform of readyPlatforms) {
          // Все платформы (ВК, YouTube, ИГ и другие) через N8N
          await this.publishToSocialMedia(contentId, platform);
        }
      } else {
        log(`Контент ${contentId}: обработка для платформ: ${readyPlatforms.join(', ')}`, 'scheduler');
        for (const platform of readyPlatforms) {
          // Все платформы (включая ВК) через N8N
          await this.publishToSocialMedia(contentId, platform);
        }
      }

    } catch (error: any) {
      log(`❌ Ошибка обработки контента ${content.id}: ${error.message}`, 'scheduler');
    }
  }
  
  /**
   * Прямая публикация clips/shorts (без N8N)
   */
  private async publishClipsDirect(content: any, platform: string): Promise<boolean> {
    const contentId = content.id;
    
    const lockAcquired = await publicationLockManager.acquireLock(contentId, platform);
    if (!lockAcquired) {
      log(`⚠️ Публикация ${platform} для ${contentId} уже в процессе (lock)`, 'scheduler');
      return false;
    }
    
    const token = await this.getAdminToken();
    
    if (!token) {
      await publicationLockManager.releaseLock(contentId, platform);
      log(`❌ Не удалось получить токен для прямой публикации ${platform}`, 'scheduler');
      return false;
    }
    
    try {
      log(`[scheduler] Прямая публикация ${platform} clips: contentId=${contentId}`, 'scheduler');
      
      const campaignResponse = await axios.get(
        `${process.env.DIRECTUS_URL}/items/user_campaigns/${content.campaign_id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const campaignSettings = campaignResponse.data.data?.social_media_settings || {};
      
      let success = false;
      let postUrl: string | undefined;
      let error: string | undefined;
      
      if (platform === 'youtube') {
        const result = await youtubeService.publishContent(content, campaignSettings, 'scheduler');
        success = result.success;
        postUrl = result.postUrl;
        error = result.error;
      } else if (platform === 'vk') {
        const result = await vkClipsService.publishClip(contentId, token);
        success = result.success;
        postUrl = result.videoUrl;
        error = result.error;
      }
      
      const contentResponse = await axios.get(
        `${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const currentContent = contentResponse.data.data;
      const socialPlatforms = currentContent.social_platforms || {};
      
      socialPlatforms[platform] = {
        ...socialPlatforms[platform],
        status: success ? 'published' : 'failed',
        postUrl,
        error,
        publishedAt: success ? new Date().toISOString() : undefined
      };
      
      const allPlatformsComplete = this.checkAllPlatformsComplete(socialPlatforms);
      const allSuccess = this.checkAllPlatformsSuccess(socialPlatforms);
      
      const updateData: any = { social_platforms: socialPlatforms };
      if (allPlatformsComplete) {
        updateData.status = allSuccess ? 'published' : 'partially_published';
      }
      
      await axios.patch(
        `${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`,
        updateData,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      log(`✅ Прямая публикация ${platform}: ${success ? 'успешно' : 'ошибка'} - ${postUrl || error}`, 'scheduler');
      return success;
      
    } catch (err: any) {
      log(`❌ Ошибка прямой публикации ${platform}: ${err.message}`, 'scheduler');
      return false;
    } finally {
      await publicationLockManager.releaseLock(contentId, platform);
    }
  }
  
  private checkAllPlatformsComplete(socialPlatforms: any): boolean {
    for (const [_, settings] of Object.entries(socialPlatforms)) {
      const s = settings as any;
      if (s?.selected && (!s.status || s.status === 'pending' || s.status === 'publishing')) {
        return false;
      }
    }
    return true;
  }
  
  private checkAllPlatformsSuccess(socialPlatforms: any): boolean {
    for (const [_, settings] of Object.entries(socialPlatforms)) {
      const s = settings as any;
      if (s?.selected && s.status !== 'published') {
        return false;
      }
    }
    return true;
  }

  /**
   * Определяет платформы готовые для публикации
   */
  private getReadyPlatforms(socialPlatforms: any): string[] {
    const readyPlatforms: string[] = [];
    
    for (const [platform, settings] of Object.entries(socialPlatforms)) {
      if (this.isPlatformReady(settings)) {
        readyPlatforms.push(platform);
      }
    }
    
    return readyPlatforms;
  }

  /**
   * Проверяет готовность платформы к публикации
   */
  private isPlatformReady(platformSettings: any): boolean {
    if (!platformSettings || typeof platformSettings !== 'object') {
      return false;
    }

    // Платформа должна быть выбрана и не опубликована
    // status === 'pending' или отсутствует статус (новая публикация)
    return platformSettings.selected === true && 
           (!platformSettings.status || platformSettings.status === 'pending' || platformSettings.status === 'failed');
  }

  /**
   * Отправляет webhook в N8N для публикации (fire-and-forget)
   */
  private async publishToSocialMedia(contentId: string, platform: string): Promise<boolean> {
    const { getN8nUrl } = require('../../utils/n8n-utils');
    const webhookUrl = `${getN8nUrl()}/webhook/publish-${platform}`;
    
    try {
      console.log(`🚀 [N8N-REQUEST] PLATFORM: ${platform}`);
      log(`[scheduler] Отправка ${platform}: contentId=${contentId}`, 'scheduler');
      
      // Fire-and-forget: отправляем без ожидания ответа, без таймаута
      axios.post(webhookUrl, {
        contentId
      }).catch(() => {
        // Игнорируем любые ошибки - N8N сам обновит статус
      });

      // Сразу обновляем статус на "publishing"
      const token = await this.getAdminToken();
      if (token) {
        await axios.patch(
          `${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`,
          { status: 'publishing' },
          { headers: { Authorization: `Bearer ${token}` } }
        ).catch(err => {
          log(`❌ Ошибка обновления статуса: ${err.message}`, 'scheduler');
        });
      }

      log(`✅ Задача отправлена в N8N для ${platform}: contentId=${contentId}`, 'scheduler');
      return true;
      
    } catch (error: any) {
      log(`❌ Ошибка отправки ${platform}: ${error.message}`, 'scheduler');
      return false;
    }
  }

  /**
   * Публикация с показом результата (для API эндпоинта)
   */
  async publishContent(contentId: string, selectedPlatforms: string[]): Promise<{success: boolean, message: string}> {
    const results = [];
    
    for (const platform of selectedPlatforms) {
      // БЛОКИРОВКИ ОТКЛЮЧЕНЫ для простого планировщика
      try {
        const success = await this.publishToSocialMedia(contentId, platform);
        results.push({platform, success});
      } catch (error: any) {
        results.push({platform, success: false, error: error.message});
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;
    
    if (successCount === totalCount) {
      return {
        success: true, 
        message: `Контент успешно отправлен на публикацию на ${totalCount} платформах`
      };
    } else if (successCount > 0) {
      return {
        success: true,
        message: `Контент отправлен на публикацию для ${successCount} из ${totalCount} платформ`
      };
    } else {
      return {
        success: false,
        message: 'Ошибка отправки во все платформы'
      };
    }
  }
}

// Синглтон экземпляр планировщика
export const publishScheduler = new PublishScheduler();