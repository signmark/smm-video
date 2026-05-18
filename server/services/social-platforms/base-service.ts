import { CampaignContent, SocialMediaSettings } from '@shared/schema';

export interface TokenValidationResult {
  isValid: boolean;
  error?: string;
  expiresAt?: Date | null;
  details?: any;
}

export abstract class BaseSocialService {
  protected platformName: string;

  constructor(platformName: string) {
    this.platformName = platformName;
  }

  abstract publishContent(
    content: CampaignContent,
    campaignSettings: SocialMediaSettings,
    userId: string
  ): Promise<{ success: boolean; postUrl?: string; error?: string }>;

  /**
   * Проверяет валидность токена для данной платформы
   */
  abstract validateToken(settings: any): Promise<TokenValidationResult>;
}
