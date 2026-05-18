// Feature flags configuration for server-side usage
// Simple JavaScript version to avoid TypeScript module issues

const DEFAULT_FEATURE_FLAGS = {
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
const getFeatureFlags = () => {
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
const FEATURE_DESCRIPTIONS = {
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

module.exports = {
  getFeatureFlags,
  DEFAULT_FEATURE_FLAGS,
  FEATURE_DESCRIPTIONS
};