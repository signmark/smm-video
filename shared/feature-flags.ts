// Feature flags configuration for controlling experimental features

export interface FeatureFlags {
  // Content creation features
  instagramStories: boolean;
  videoEditor: boolean;
  aiImageGeneration: boolean;
  
  // Social media platforms
  youtubePublishing: boolean;
  instagramPublishing: boolean;
  telegramPublishing: boolean;
  
  // Analytics and insights
  sentimentAnalysis: boolean;
  trendsAnalysis: boolean;
  commentCollection: boolean;
  
  // Advanced features
  automatedPosting: boolean;
  schedulerAdvanced: boolean;
  multiCampaignManagement: boolean;
}

// Default feature flags configuration
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  // Content creation - stable features enabled
  instagramStories: true, // Enabled for Stories functionality
  videoEditor: true,
  aiImageGeneration: true,
  
  // Social platforms - stable ones enabled
  youtubePublishing: true,
  instagramPublishing: false, // N8N workflow needs testing
  telegramPublishing: true,
  
  // Analytics - all stable
  sentimentAnalysis: true,
  trendsAnalysis: true,
  commentCollection: true,
  
  // Advanced features - all stable
  automatedPosting: true,
  schedulerAdvanced: true,
  multiCampaignManagement: true,
};

// Environment-based feature flags
export const getFeatureFlags = (): FeatureFlags => {
  const env = process.env.NODE_ENV || 'development';
  
  switch (env) {
    case 'production':
      return {
        ...DEFAULT_FEATURE_FLAGS,
        // Production features
        instagramStories: true,
        instagramPublishing: false,
        videoEditor: true,
      };
      
    case 'staging':
      return {
        ...DEFAULT_FEATURE_FLAGS,
        // Enable more features for testing
        instagramStories: true,
        instagramPublishing: true,
      };
      
    case 'development':
    default:
      return {
        ...DEFAULT_FEATURE_FLAGS,
        // Enable all features for development
        instagramStories: true,
        instagramPublishing: true,
      };
  }
};

// Feature flag descriptions for admin interface
export const FEATURE_DESCRIPTIONS: Record<keyof FeatureFlags, string> = {
  instagramStories: 'Instagram Stories редактор и публикация',
  videoEditor: 'Видео редактор и обработка',
  aiImageGeneration: 'AI генерация изображений',
  youtubePublishing: 'Публикация на YouTube',
  instagramPublishing: 'Публикация в Instagram',
  telegramPublishing: 'Публикация в Telegram',
  sentimentAnalysis: 'Анализ настроения комментариев',
  trendsAnalysis: 'Анализ трендов и источников',
  commentCollection: 'Сбор комментариев из соцсетей',
  automatedPosting: 'Автоматическая публикация по расписанию',
  schedulerAdvanced: 'Расширенные функции планировщика',
  multiCampaignManagement: 'Управление множественными кампаниями',
};