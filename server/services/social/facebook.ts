/**
 * Сервис для интеграции с Facebook
 * Просто реэкспортирует функционал из social-platforms/facebook-service.ts
 */

import { facebookService } from '../social-platforms/facebook-service';
import { CampaignContent, SocialPlatform, SocialPublication } from '@shared/schema';

export class FacebookSocialService {
  /**
   * Публикует контент в Facebook
   * @param content Контент для публикации
   * @param settings Настройки Facebook (access_token, pageId)
   * @returns Результат публикации
   */
  async publish(content: CampaignContent, settings: any): Promise<SocialPublication> {
    return await facebookService.publishToFacebook(content, settings);
  }

  /**
   * Обновляет статус публикации контента в Facebook
   * @param contentId ID контента
   * @param platform Социальная платформа (всегда 'facebook')
   * @param publicationResult Результат публикации
   * @returns Обновленный контент или null в случае ошибки
   */
  async updatePublicationStatus(
    contentId: string,
    platform: SocialPlatform,
    publicationResult: SocialPublication
  ): Promise<CampaignContent | null> {
    return await facebookService.updatePublicationStatus(contentId, platform, publicationResult);
  }
}

// Создаем экземпляр сервиса как синглтон
export const facebookSocialService = new FacebookSocialService();