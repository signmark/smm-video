import { directusCrud } from './directus-crud';
import { facebookService } from './social-platforms/facebook-service';
import { instagramReelsService } from './social-platforms/instagram-reels-service';
import { tiktokService } from './social-platforms/tiktok-service';
import { vkClipsService } from './social-platforms/vk-clips-service';
import { vkStoriesService } from './social-platforms/vk-stories-service';
import { YouTubeService } from './social-platforms/youtube-service';
import { log } from '../utils/logger';
import { getTelegramBot } from '../telegram-bot/bot-launcher';

const LOG_PREFIX = 'status-validator';

export class StatusValidator {
  private youtubeService = new YouTubeService();

  /**
   * Проверяет все токены для конкретной кампании
   */
  async validateCampaignTokens(campaignId: string): Promise<Record<string, any>> {
    log(`Начинаю валидацию токенов для кампании ${campaignId}`, LOG_PREFIX);
    
    try {
      const campaign = await directusCrud.getById('user_campaigns', campaignId, { useAdminToken: true }) as any;
      if (!campaign) throw new Error('Кампания не найдена');

      const settings = campaign.social_settings || campaign.social_media_settings || {};
      const results: Record<string, any> = {};

      // 1. Facebook
      if (settings.facebook?.token) {
        results.facebook = await facebookService.validateToken(settings.facebook);
      }

      // 2. Instagram
      if (settings.instagram?.token || settings.instagram?.accessToken) {
        results.instagram = await instagramReelsService.validateToken(settings.instagram);
      }

      // 3. VK
      if (settings.vk?.token) {
        results.vk = await vkStoriesService.validateToken(settings.vk);
      }

      // 4. TikTok
      if (settings.tiktok?.token || settings.tiktok?.accessToken) {
        results.tiktok = await tiktokService.validateToken(settings.tiktok);
      }

      // 5. YouTube
      if (settings.youtube?.token || settings.youtube?.accessToken) {
        results.youtube = await this.youtubeService.validateToken(settings.youtube);
      }

      log(`Валидация завершена для ${campaignId}. Проблем: ${Object.values(results).filter(r => !r.isValid).length}`, LOG_PREFIX);
      
      // Если есть ошибки, уведомляем админа/пользователя
      await this.notifyIfIssues(campaign, results);

      return results;
    } catch (error: any) {
      log(`Ошибка валидации кампании ${campaignId}: ${error.message}`, LOG_PREFIX, 'error');
      return { error: error.message };
    }
  }

  /**
   * Уведомляет пользователя через Telegram если найдены невалидные токены
   */
  private async notifyIfIssues(campaign: any, results: Record<string, any>) {
    const invalidPlatforms = Object.entries(results)
      .filter(([_, res]) => !res.isValid)
      .map(([name, res]) => `${name.toUpperCase()}: ${res.error}`);

    if (invalidPlatforms.length > 0) {
      const bot = getTelegramBot();
      const userId = campaign.user_id;
      
      // Ищем chatId пользователя в сессиях (упрощенно)
      // В реальной системе лучше хранить telegram_chat_id в профиле пользователя directus_users
      const supportChatId = process.env.SUPPORT_CHAT_ID || '276351686';

      if (bot) {
        const message = `⚠️ <b>Проблема с токенами в кампании "${campaign.name}"</b>\n\n` +
          `Обнаружены невалидные доступы:\n` +
          invalidPlatforms.map(p => `• ${p}`).join('\n') +
          `\n\nПожалуйста, обновите настройки в приложении.`;
        
        await bot.sendMessage(supportChatId, message).catch(() => {});
      }
    }
  }
  /**
   * Запускает периодическую валидацию всех кампаний
   */
  async startValidation() {
    log('Запуск периодической валидации всех кампаний', LOG_PREFIX);
    // Пока просто логируем, так как метод еще не реализован полностью
    // В будущем здесь будет цикл по всем кампаниям
  }
}

export const statusValidator = new StatusValidator();
