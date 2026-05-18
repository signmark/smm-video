/**
 * Минимальная схема для обратной совместимости
 * Все данные хранятся в Directus
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
  campaignId?: string;
  status?: string;
  contentType?: string;
  content_type?: string;
  title?: string | null;
  socialPlatforms?: any;
  social_platforms?: any;
}

export interface InsertCampaignContent {
  campaign_id: string;
  content: string;
  platform?: SocialPlatform;
}

export interface SocialMediaSettings {
  id: string;
  campaign_id: string;
  platform: SocialPlatform;
  settings: any;
}

export interface SocialPublication {
  id?: string;
  content_id?: string;
  platform: SocialPlatform;
  status: string;
  publishedAt?: Date | string | null;
  postUrl?: string;
  postId?: string;
  error?: string | null;
}

export interface ContentSource {
  id: string;
  name: string;
  url: string;
}

export interface InsertTrendTopic {
  topic: string;
  campaign_id: string;
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
  sourceId: z.string().nullable().optional(),
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
