/**
 * Схема типов приложения.
 * Все данные хранятся в Directus; здесь — типы для обмена между server и client.
 *
 * Directus возвращает поля в snake_case, часть кода исторически использует camelCase —
 * поэтому у сущностей присутствуют оба варианта как optional-алиасы.
 */

import { z } from 'zod';

// Типы для обратной совместимости
export type SocialPlatform = 'facebook' | 'instagram' | 'vk' | 'telegram' | 'youtube' | 'threads';

export interface CampaignContent {
  id: string;
  campaign_id: string;
  content: string;
  platform?: SocialPlatform;
  imageUrl?: string;
  image_url?: string;
  user_id?: string;
  userId?: string;
  campaignId?: string;
  status?: string;
  contentType?: string;
  content_type?: string;
  title?: string | null;
  socialPlatforms?: any;
  social_platforms?: any;
  publishedPlatforms?: any;
  // Медиа
  images?: string[];
  additionalImages?: any;
  additionalMedia?: any[] | null;
  videoUrl?: string | null;
  video_url?: string | null;
  videoThumbnail?: string | null;
  additionalVideos?: any;
  // Метаданные генерации
  keywords?: any[] | null;
  hashtags?: string[] | null;
  tags?: any[] | null;
  metadata?: any;
  prompt?: string | null;
  imagePrompt?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  // Время (Directus отдаёт ISO-строки)
  scheduled_at?: string | null;
  scheduledAt?: Date | string | null;
  published_at?: string | null;
  publishedAt?: Date | string | null;
  created_at?: string;
  createdAt?: Date | string | null;
  updated_at?: string;
}

export interface InsertCampaignContent {
  // Часть вызовов передаёт campaignId (camelCase) — storage читает именно его, поэтому оба optional.
  campaign_id?: string;
  content: string;
  platform?: SocialPlatform;
  campaignId?: string;
  userId?: string;
  user_id?: string;
  title?: string | null;
  status?: string;
  contentType?: string;
  content_type?: string;
  imageUrl?: string;
  image_url?: string;
  images?: string[];
  additionalImages?: any;
  additionalMedia?: any[] | null;
  videoUrl?: string | null;
  video_url?: string | null;
  videoThumbnail?: string | null;
  additionalVideos?: any;
  keywords?: any[] | null;
  hashtags?: string[] | null;
  metadata?: any;
  prompt?: string | null;
  socialPlatforms?: any;
  social_platforms?: any;
  scheduled_at?: string | null;
  scheduledAt?: Date | string | null;
  published_at?: string | null;
  publishedAt?: Date | string | null;
}

// Пер-платформенные настройки кампании (поле social_media_settings в user_campaigns).
export interface SocialMediaSettings {
  telegram?: {
    token?: string | null;
    chatId?: string | null;
    [key: string]: any;
  };
  vk?: {
    token?: string | null;
    groupId?: string | null;
    [key: string]: any;
  };
  instagram?: {
    token?: string | null;
    accessToken?: string | null;
    businessAccountId?: string | null;
    appId?: string | null;
    appSecret?: string | null;
    [key: string]: any;
  };
  facebook?: {
    token?: string | null;
    pageId?: string | null;
    [key: string]: any;
  };
  youtube?: {
    apiKey?: string | null;
    channelId?: string | null;
    accessToken?: string | null;
    refreshToken?: string | null;
    [key: string]: any;
  };
  threads?: {
    token?: string | null;
    accessToken?: string | null;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface SocialPublication {
  id?: string;
  content_id?: string;
  platform: SocialPlatform;
  status: string;
  publishedAt?: Date | string | null;
  scheduledAt?: Date | string | null;
  postUrl?: string;
  postId?: string;
  messageId?: string | number;
  userId?: string;
  selected?: boolean;
  error?: string | null;
}

// Кампания (коллекция user_campaigns в Directus).
// storage маппит Directus-поле user_id в userId, поэтому userId присутствует всегда.
export interface UserCampaign {
  id: string;
  userId: string;
  user_id?: string;
  name?: string | null;
  link?: string | null;
  description?: string | null;
  created_at?: string;
  createdAt?: Date | string;
  updated_at?: string;
  updatedAt?: Date | string;
  trend_analysis_settings?: any;
  trendAnalysisSettings?: any;
  social_media_settings?: any;
  socialMediaSettings?: any;
}

export type Campaign = UserCampaign;

export interface InsertUserCampaign {
  user_id?: string;
  userId?: string;
  name?: string | null;
  link?: string | null;
  description?: string | null;
  trend_analysis_settings?: any;
  trendAnalysisSettings?: any;
  social_media_settings?: any;
  socialMediaSettings?: any;
}

export type InsertCampaign = InsertUserCampaign;

export interface ContentSource {
  id: string;
  name: string;
  url: string;
  type?: string;
  isActive?: boolean;
  is_active?: boolean;
  userId?: string;
  user_id?: string;
  campaignId?: string | number;
  campaign_id?: string;
}

export interface InsertContentSource {
  name: string;
  url: string;
  type?: string;
  isActive?: boolean;
  is_active?: boolean;
  userId?: string;
  user_id?: string;
  campaignId?: string | number;
  campaign_id?: string;
}

// Трендовые топики
export interface TrendTopic {
  id: number | string;
  directusId?: string;
  title: string;
  sourceId?: number | string;
  reactions?: number;
  comments?: number;
  views?: number;
  createdAt?: Date | string;
  campaignId?: number | string;
  isBookmarked?: boolean;
  userId?: string;
}

export interface InsertTrendTopic {
  topic?: string;
  title?: string;
  campaign_id?: string;
  campaignId?: number | string;
  sourceId?: number | string;
  reactions?: number;
  comments?: number;
  views?: number;
  isBookmarked?: boolean;
  userId?: string;
}

export interface CampaignTrendTopic {
  id: string;
  title: string;
  sourceId?: string | null;
  sourceName?: string;
  sourceUrl?: string;
  reactions?: number;
  comments?: number;
  views?: number;
  createdAt?: Date | string;
  isBookmarked?: boolean;
  campaignId?: string;
}

// Ключевые слова кампании
export interface CampaignKeyword {
  id: string;
  campaignId?: string;
  campaign_id?: string;
  keyword: string;
  trend?: number;
  competition?: number;
  trendScore?: string | number;
  mentionsCount?: number;
  lastChecked?: Date | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface InsertCampaignKeyword {
  campaignId?: string;
  campaign_id?: string;
  keyword: string;
  trend?: number;
  competition?: number;
  trendScore?: string | number;
  mentionsCount?: number;
}

// Видео-инструкции
export interface VideoTutorial {
  id: string;
  tutorialId?: string;
  title: string;
  description?: string | null;
  category?: string;
  videoPath?: string | null;
  duration?: string | null;
  uploadedBy?: string;
  isActive?: boolean;
  mimeType?: string | null;
  sizeBytes?: number | null;
  transcript?: string | null;
  tags?: string[] | null;
  thumbnailPath?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface InsertVideoTutorial {
  title: string;
  description?: string | null;
  category?: string;
  videoPath?: string | null;
  duration?: string | null;
  isActive?: boolean;
  mimeType?: string | null;
  sizeBytes?: number | null;
  transcript?: string | null;
  tags?: string[] | null;
  thumbnailPath?: string | null;
}

// Типы для системы умного бота
export type BotOutcomeType = 'success' | 'fail';
export type BotErrorCode = 'AUTH_MISSING' | 'RATE_LIMIT' | 'VALIDATION' | 'NETWORK' | 'PLATFORM_DOWN' | 'UNKNOWN' | null;

export interface BotActionAttempt {
  traceId: string;
  actionName: string;
  contextSignature: string;
  params: Record<string, any>;
  startTime: Date;
}

export interface BotActionOutcome extends BotActionAttempt {
  outcomeType: BotOutcomeType;
  errorCode?: BotErrorCode;
  errorDetails?: string;
  durationMs: number;
  reward: number;
  endTime: Date;
}

export interface BotExperience {
  id: string;
  traceId: string;
  actionName: string;
  contextSignature: string;
  params: Record<string, any>;
  outcomeType: BotOutcomeType;
  errorCode: BotErrorCode;
  errorDetails: string | null;
  durationMs: number;
  reward: number;
  // Хранится in-memory, всегда Date — по нему сортируют и сравнивают.
  createdAt: Date;
}

export type InsertBotExperience = Omit<BotExperience, 'id' | 'createdAt'>;

export interface BotPattern {
  id: string;
  actionName: string;
  contextSignature: string;
  params: Record<string, any>;
  trials: number;
  successes: number;
  score: number;
  lastUsedAt?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export type InsertBotPattern = Omit<BotPattern, 'id' | 'createdAt' | 'updatedAt'>;

// Настройки анализа трендов
export interface TrendAnalysisSettings {
  minFollowers: {
    instagram: number;
    telegram: number;
    vk: number;
    facebook: number;
    youtube: number;
  };
  maxSourcesPerPlatform: number;
  maxTrendsPerSource: number;
  minViews?: number;
  collectionDays?: number;
}


// Zod схемы для валидации
export const insertBusinessQuestionnaireSchema = z.object({
  id: z.string().optional(),
  campaign_id: z.string(),
  // Поддержка обоих форматов: snake_case и camelCase
  business_name: z.string().optional(),
  companyName: z.string().optional(),
  contact_info: z.string().optional(),
  contactInfo: z.string().optional(),
  business_description: z.string().optional(),
  businessDescription: z.string().optional(),
  main_directions: z.string().optional(),
  mainDirections: z.string().optional(),
  brand_image: z.string().optional(),
  brandImage: z.string().optional(),
  products_services: z.string().optional(),
  productsServices: z.string().optional(),
  target_audience: z.string().optional(),
  targetAudience: z.string().optional(),
  customer_results: z.string().optional(),
  customerResults: z.string().optional(),
  company_features: z.string().optional(),
  companyFeatures: z.string().optional(),
  business_values: z.string().optional(),
  businessValues: z.string().optional(),
  product_beliefs: z.string().optional(),
  productBeliefs: z.string().optional(),
  competitive_advantages: z.string().optional(),
  competitiveAdvantages: z.string().optional(),
  marketing_expectations: z.string().optional(),
  marketingExpectations: z.string().optional(),
  key_messages: z.string().optional(),
});

export type InsertBusinessQuestionnaire = z.infer<typeof insertBusinessQuestionnaireSchema>;

// Возвращаемая форма (storage маппит snake_case Directus → camelCase).
export interface BusinessQuestionnaire {
  id: string;
  campaignId?: string;
  companyName?: string;
  contactInfo?: string;
  businessDescription?: string;
  mainDirections?: string;
  brandImage?: string;
  productsServices?: string;
  targetAudience?: string;
  customerResults?: string;
  companyFeatures?: string;
  businessValues?: string;
  productBeliefs?: string;
  competitiveAdvantages?: string;
  marketingExpectations?: string;
  keyMessages?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

// Схема для сообщений технической поддержки
export const insertSupportMessageSchema = z.object({
  message: z.string().min(1, 'Сообщение не может быть пустым'),
  userId: z.string().optional(),
});

export type InsertSupportMessage = z.infer<typeof insertSupportMessageSchema>;

// Схема для трендов кампании
export const insertCampaignTrendTopicSchema = z.object({
  title: z.string(),
  campaignId: z.string(),
  directusId: z.string().optional(),
  sourceId: z.string().nullable().optional(),
  sourceName: z.string().optional(),
  sourceUrl: z.string().optional(),
  reactions: z.number().default(0),
  comments: z.number().default(0),
  views: z.number().default(0),
  isBookmarked: z.boolean().default(false)
});

export type InsertCampaignTrendTopic = z.infer<typeof insertCampaignTrendTopicSchema>;

export interface SupportMessage extends InsertSupportMessage {
  id: string;
  timestamp: Date;
  status: 'pending' | 'sent' | 'error';
}

// Пустые экспорты для старых таблиц
export const users = null;
export const videoTutorials = null;
export const userCampaigns = null;
export const businessQuestionnaires = null;
