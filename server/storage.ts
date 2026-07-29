import { directusApi } from "./lib/directus";
import { directusStorageAdapter } from './services/directus';
import { resolvePublishingToken } from './services/publishing-token';
import axios from 'axios';
import { 
  type UserCampaign, 
  type InsertUserCampaign,
  type BusinessQuestionnaire,
  type InsertBusinessQuestionnaire,
  type Campaign,
  type InsertCampaign,
  type ContentSource,
  type InsertContentSource,
  type TrendTopic,
  type InsertTrendTopic,
  type CampaignTrendTopic,
  type InsertCampaignTrendTopic,
  type CampaignContent,
  type InsertCampaignContent,
  type CampaignKeyword,
  type InsertCampaignKeyword,
  type BotExperience,
  type InsertBotExperience,
  type BotPattern,
  type InsertBotPattern,
  type BotActionAttempt,
  type BotActionOutcome,
  type BotOutcomeType,
  type BotErrorCode,
  type VideoTutorial,
  type InsertVideoTutorial
} from "@shared/schema";

// Тип для информации о токене пользователя
export interface UserTokenInfo {
  token: string;
  refreshToken?: string;
  userId: string;
}

// scheduledAt приходит и как Date, и как ISO-строка — приводим к ISO-строке для Directus.
function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export interface IStorage {
  // User Authentication
  getUserTokenInfo(userId: string): Promise<UserTokenInfo | null>;
  
  // Campaigns
  getCampaigns(userId: string): Promise<Campaign[]>;
  getCampaign(id: number): Promise<Campaign | undefined>;
  createCampaign(campaign: InsertCampaign): Promise<Campaign>;
  deleteCampaign(id: number): Promise<void>;

  // Content Sources and Trends
  getContentSources(userId: string, campaignId?: number): Promise<ContentSource[]>;
  createContentSource(source: InsertContentSource): Promise<ContentSource>;
  deleteContentSource(id: number, userId: string): Promise<void>;
  getTrendTopics(params: { from?: Date; to?: Date; campaignId?: number }): Promise<TrendTopic[]>;
  createTrendTopic(topic: InsertTrendTopic): Promise<TrendTopic>;
  
  // Campaign Trend Topics from webhook
  getCampaignTrendTopics(params: { from?: Date; to?: Date; campaignId?: string }): Promise<CampaignTrendTopic[]>;
  createCampaignTrendTopic(topic: InsertCampaignTrendTopic): Promise<CampaignTrendTopic>;
  bookmarkCampaignTrendTopic(id: string, isBookmarked: boolean): Promise<CampaignTrendTopic>;
  
  // Campaign Content
  getCampaignContent(userId: string, campaignId?: string): Promise<CampaignContent[]>;
  /** Пользовательское чтение: токен обязателен, эскалации нет. */
  getCampaignContentById(id: string, authToken?: string): Promise<CampaignContent | undefined>;
  /** Служебное чтение любого арендатора. Только после подтверждённого ownership или из фона. */
  getCampaignContentByIdPrivileged(id: string): Promise<CampaignContent | undefined>;
  createCampaignContent(content: InsertCampaignContent): Promise<CampaignContent>;
  /** Пользовательская запись: токен обязателен. */
  updateCampaignContent(id: string, updates: Partial<InsertCampaignContent>, authToken?: string): Promise<CampaignContent>;
  /** Служебная запись любого арендатора. Только после подтверждённого ownership или из фона. */
  updateCampaignContentPrivileged(id: string, updates: Partial<InsertCampaignContent>): Promise<CampaignContent>;
  deleteCampaignContent(id: string): Promise<void>;
  getScheduledContent(userId: string, campaignId?: string): Promise<CampaignContent[]>;
  getScheduledCampaignContent(campaignId: string, userId: string, token?: string): Promise<CampaignContent[]>;
  
  // Business Questionnaire
  getBusinessQuestionnaire(campaignId: string): Promise<BusinessQuestionnaire | null>;
  // Stories/Slides/Elements обрабатываются через directusCrud, не через этот слой.
  createBusinessQuestionnaire(questionnaire: InsertBusinessQuestionnaire): Promise<BusinessQuestionnaire>;
  updateBusinessQuestionnaire(id: string, updates: Partial<InsertBusinessQuestionnaire>): Promise<BusinessQuestionnaire>;
  
  // Campaign Keywords
  getCampaignKeywords(campaignId: string): Promise<CampaignKeyword[]>;
  createCampaignKeyword(keyword: InsertCampaignKeyword): Promise<CampaignKeyword>;
  deleteCampaignKeyword(id: string): Promise<void>;
  updateCampaignKeyword(id: string, updates: Partial<InsertCampaignKeyword>): Promise<CampaignKeyword>;
  
  // Smart Bot Experience Management
  recordBotAttempt(attempt: BotActionAttempt): Promise<BotExperience>;
  recordBotOutcome(outcome: BotActionOutcome): Promise<BotExperience>;
  getBotExperiences(actionName?: string, contextSignature?: string): Promise<BotExperience[]>;
  getTopBotPatterns(actionName: string, contextSignature?: string, limit?: number): Promise<BotPattern[]>;
  findSimilarContexts(actionName: string, contextSignature: string, limit?: number): Promise<BotPattern[]>;
  incrementPatternStats(patternId: string, success: boolean): Promise<BotPattern>;
  createOrUpdateBotPattern(pattern: Partial<InsertBotPattern>): Promise<BotPattern>;
  cleanupOldExperiences(olderThanDays: number): Promise<number>;
  
  // Video Tutorials moved to Directus - use directusCrud instead
}

export class DatabaseStorage implements IStorage {
  // Кэш токенов пользователей
  private tokenCache: Record<string, { token: string; expiresAt: number }> = {};
  
  // User Authentication
  async getUserTokenInfo(userId: string): Promise<UserTokenInfo | null> {
    try {
      // Токены для каждого пользователя хранятся на клиенте в localStorage
      // На сервере мы предполагаем, что токен передается через заголовок Authorization
      // В продакшн-реализации следует хранить токены в защищенном хранилище
      console.log(`Getting token info for user: ${userId}`);
      
      // Запрашиваем токен из системы сессий или временного хранилища
      // В реальном приложении здесь будет запрос к БД или Redis
      
      // Для демонстрационных целей, можно использовать переменную окружения с токеном
      const serviceToken = process.env.DIRECTUS_SERVICE_TOKEN;
      if (serviceToken) {
        return {
          token: serviceToken,
          userId: userId
        };
      }
      
      // Возвращаем null, если не нашли токен
      return null;
    } catch (error) {
      console.error('Error getting user token info:', error);
      return null;
    }
  }
  
  // Content Sources
  async getContentSources(userId: string, campaignId?: number): Promise<ContentSource[]> {
    console.log('Getting content sources with params:', { userId, campaignId });
    try {
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        console.error('No auth token found for user', userId);
        return [];
      }
      
      const filter: any = {
        user_id: {
          _eq: userId
        },
        is_active: {
          _eq: true
        }
      };
      
      if (campaignId !== undefined) {
        filter.campaign_id = {
          _eq: campaignId
        };
      }
      
      const response = await directusApi.get('/items/campaign_content_sources', {
        params: {
          filter
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      console.log('Found', response.data?.data?.length, 'sources for user', userId);
      
      const sources = (response.data?.data || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        url: item.url,
        type: item.type,
        isActive: item.is_active,
        userId: item.user_id,
        campaignId: item.campaign_id
      }));
      
      return sources;
    } catch (error) {
      console.error('Error getting content sources from Directus:', error);
      return [];
    }
  }

  async createContentSource(source: InsertContentSource): Promise<ContentSource> {
    console.log('Creating content source:', source);
    try {
      const authToken = await this.getAuthToken(source.userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      const response = await directusApi.post('/items/campaign_content_sources', {
        name: source.name,
        url: source.url,
        type: source.type,
        is_active: source.isActive,
        user_id: source.userId,
        campaign_id: source.campaignId
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      const item = response.data.data;
      return {
        id: item.id,
        name: item.name,
        url: item.url,
        type: item.type,
        isActive: item.is_active,
        userId: item.user_id,
        campaignId: item.campaign_id
      };
    } catch (error) {
      console.error('Error creating content source in Directus:', error);
      throw new Error('Failed to create content source');
    }
  }

  async deleteContentSource(id: number, userId: string): Promise<void> {
    try {
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      // Мы используем PATCH вместо DELETE для soft delete
      await directusApi.patch(`/items/campaign_content_sources/${id}`, {
        is_active: false
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
    } catch (error) {
      console.error('Error deactivating content source in Directus:', error);
      throw new Error('Failed to deactivate content source');
    }
  }

  // Trend Topics
  async getTrendTopics(params: { from?: Date; to?: Date; campaignId?: number } = {}): Promise<TrendTopic[]> {
    console.log('Fetching trends with params:', params);
    try {
      // Здесь нам нужно знать userId, чтобы получить токен, но параметра userId нет
      // В реальной реализации нужно получить userId из campaignId или из другого источника
      let userId: string | null = null;
      
      if (params.campaignId) {
        const campaign = await this.getCampaign(params.campaignId);
        if (campaign) {
          userId = campaign.userId;
        }
      }
      
      if (!userId) {
        console.error('Cannot determine user ID for trend topics');
        return [];
      }
      
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        console.error('No auth token found for user', userId);
        return [];
      }
      
      const filter: any = {};
      
      if (params.from) {
        filter.created_at = {
          _gte: params.from.toISOString()
        };
      }
      
      if (params.to) {
        if (!filter.created_at) filter.created_at = {};
        filter.created_at._lte = params.to.toISOString();
      }
      
      if (params.campaignId) {
        filter.campaign_id = {
          _eq: params.campaignId
        };
      }
      
      const response = await directusApi.get('/items/trend_topics', {
        params: {
          filter,
          sort: ['-created_at']
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      console.log('Found', response.data?.data?.length, 'trend topics for campaign', params.campaignId);
      
      const topics = (response.data?.data || []).map((item: any) => ({
        id: item.id,
        directusId: item.directus_id,
        title: item.title,
        sourceId: item.source_id,
        reactions: item.reactions,
        comments: item.comments,
        views: item.views,
        createdAt: new Date(item.created_at),
        campaignId: item.campaign_id,
        isBookmarked: item.is_bookmarked
      }));
      
      return topics;
    } catch (error) {
      console.error('Error getting trend topics from Directus:', error);
      return [];
    }
  }

  async createTrendTopic(topic: InsertTrendTopic): Promise<TrendTopic> {
    console.log('Creating trend topic:', topic);
    try {
      const authToken = await this.getAuthToken(topic.userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      const response = await directusApi.post('/items/trend_topics', {
        title: topic.title,
        source_id: topic.sourceId,
        reactions: topic.reactions,
        comments: topic.comments,
        views: topic.views,
        campaign_id: topic.campaignId,
        is_bookmarked: topic.isBookmarked || false,
        user_id: topic.userId
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      const item = response.data.data;
      return {
        id: item.id,
        directusId: item.directus_id,
        title: item.title,
        sourceId: item.source_id,
        reactions: item.reactions,
        comments: item.comments,
        views: item.views,
        createdAt: new Date(item.created_at),
        campaignId: item.campaign_id,
        isBookmarked: item.is_bookmarked,
        userId: item.user_id
      };
    } catch (error) {
      console.error('Error creating trend topic in Directus:', error);
      throw new Error('Failed to create trend topic');
    }
  }

  // Campaign Trend Topics from webhook
  async getCampaignTrendTopics(params: { from?: Date; to?: Date; campaignId?: string } = {}): Promise<CampaignTrendTopic[]> {
    console.log('Fetching campaign trend topics with params:', params);
    try {
      // В идеале сюда должен передаваться userId для получения токена
      // Но в текущей архитектуре это не предусмотрено
      // В реальной реализации нужно получить userId из campaignId
      let userId: string | null = null;
      
      if (params.campaignId) {
        // Используем getCampaignById вместо getCampaign, так как он не требует userId
        const campaign = await this.getCampaignById(params.campaignId);
        if (campaign) {
          userId = campaign.userId;
        }
      }
      
      if (!userId) {
        console.error('Cannot determine user ID for campaign trend topics');
        return [];
      }
      
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        console.error('No auth token found for user', userId);
        return [];
      }
      
      const filter: any = {};
      
      if (params.from) {
        filter.created_at = {
          _gte: params.from.toISOString()
        };
      }
      
      if (params.to) {
        if (!filter.created_at) filter.created_at = {};
        filter.created_at._lte = params.to.toISOString();
      }
      
      if (params.campaignId) {
        filter.campaign_id = {
          _eq: params.campaignId
        };
      }
      
      const response = await directusApi.get('/items/campaign_trend_topics', {
        params: {
          filter,
          sort: ['-created_at']
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      console.log('Found', response.data?.data?.length, 'campaign trend topics');
      
      const topics = (response.data?.data || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        sourceId: item.source_id,
        sourceName: item.source_name,
        sourceUrl: item.source_url,
        reactions: item.reactions,
        comments: item.comments,
        views: item.views,
        createdAt: new Date(item.created_at),
        isBookmarked: item.is_bookmarked,
        campaignId: item.campaign_id
      }));
      
      return topics;
    } catch (error) {
      console.error('Error getting campaign trend topics from Directus:', error);
      return [];
    }
  }

  async createCampaignTrendTopic(topic: InsertCampaignTrendTopic): Promise<CampaignTrendTopic> {
    console.log('Creating campaign trend topic:', topic);
    try {
      // Здесь необходимо иметь userId для авторизации
      // В текущей модели данных для CampaignTrendTopic нет userId
      // В реальной реализации нужно получить userId из campaignId
      let userId: string | null = null;
      
      if (topic.campaignId) {
        const campaignIdNum = typeof topic.campaignId === 'number' ? 
          topic.campaignId : parseInt(topic.campaignId as string, 10);
          
        if (!isNaN(campaignIdNum)) {
          const campaign = await this.getCampaign(campaignIdNum);
          if (campaign) {
            userId = campaign.userId;
          }
        }
      }
      
      if (!userId) {
        console.error('Cannot determine user ID for creating campaign trend topic');
        throw new Error('User ID required for authentication');
      }
      
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      // Преобразуем данные из нашей схемы в формат Directus
      const directusTopic = {
        title: topic.title,
        source_id: topic.sourceId,
        source_name: topic.sourceName,
        source_url: topic.sourceUrl,
        reactions: topic.reactions,
        comments: topic.comments,
        views: topic.views,
        is_bookmarked: topic.isBookmarked || false,
        campaign_id: String(topic.campaignId)
      };
      
      const response = await directusApi.post('/items/campaign_trend_topics', directusTopic, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      const item = response.data.data;
      return {
        id: item.id,
        title: item.title,
        sourceId: item.source_id,
        sourceName: item.source_name,
        sourceUrl: item.source_url,
        reactions: item.reactions,
        comments: item.comments,
        views: item.views,
        createdAt: new Date(item.created_at),
        isBookmarked: item.is_bookmarked,
        campaignId: item.campaign_id
      };
    } catch (error) {
      console.error('Error creating campaign trend topic in Directus:', error);
      throw new Error('Failed to create campaign trend topic');
    }
  }

  async bookmarkCampaignTrendTopic(id: string, isBookmarked: boolean): Promise<CampaignTrendTopic> {
    console.log(`${isBookmarked ? 'Bookmarking' : 'Unbookmarking'} campaign trend topic:`, id);
    try {
      // Здесь необходимо иметь userId для авторизации
      // Сначала нужно получить текущий топик чтобы найти campaignId, а через него userId
      const topic = await this.getCampaignTrendTopicById(id);
      if (!topic) {
        throw new Error('Topic not found');
      }
      
      let userId: string | null = null;
      
      if (topic.campaignId) {
        const campaignIdNum = parseInt(topic.campaignId, 10);
        if (!isNaN(campaignIdNum)) {
          const campaign = await this.getCampaign(campaignIdNum);
          if (campaign) {
            userId = campaign.userId;
          }
        }
      }
      
      if (!userId) {
        console.error('Cannot determine user ID for bookmarking campaign trend topic');
        throw new Error('User ID required for authentication');
      }
      
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      const response = await directusApi.patch(`/items/campaign_trend_topics/${id}`, {
        is_bookmarked: isBookmarked
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      const item = response.data.data;
      return {
        id: item.id,
        title: item.title,
        sourceId: item.source_id,
        sourceName: item.source_name,
        sourceUrl: item.source_url,
        reactions: item.reactions,
        comments: item.comments,
        views: item.views,
        createdAt: new Date(item.created_at),
        isBookmarked: item.is_bookmarked,
        campaignId: item.campaign_id
      };
    } catch (error) {
      console.error('Error bookmarking campaign trend topic in Directus:', error);
      throw new Error('Failed to bookmark campaign trend topic');
    }
  }
  
  // Вспомогательный метод для получения кампанийного тренда по ID
  private async getCampaignTrendTopicById(id: string): Promise<CampaignTrendTopic | null> {
    try {
      // Здесь мы сталкиваемся с проблемой авторизации - нам нужен токен
      // В реальном сценарии этот метод должен быть реализован через подключение
      // к базе данных с сервисным токеном или через административный доступ
      // Для прототипа мы просто возвращаем null
      console.log('Getting campaign trend topic by ID:', id);
      return null;
    } catch (error) {
      console.error('Error getting campaign trend topic by ID:', error);
      return null;
    }
  }

  // Campaigns
  async getCampaigns(userId: string): Promise<Campaign[]> {
    console.log('Sending request to Directus with filter user_id =', userId);
    try {
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        console.error('No auth token found for user', userId);
        return [];
      }
      
      const response = await directusApi.get('/items/user_campaigns', {
        params: {
          filter: {
            user_id: {
              _eq: userId
            }
          }
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      console.log('Filtering server-side for userId:', userId);
      console.log('Found', response.data?.data?.length, 'campaigns for user', userId, '(filtered from', response.data?.data?.length, 'total)');

      // Check data integrity
      if (response.data?.data) {
        const userIds = response.data.data.map((c: any) => c.user_id);
        console.log('All campaign user_ids in response:', userIds.join(', '));
        console.log('User ID from request:', userId);
        console.log('Types - userId:', typeof userId, 'first db userId:', typeof userIds[0]);
      }

      const campaigns = (response.data?.data || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        userId: item.user_id
      }));
      
      return campaigns;
    } catch (error) {
      console.error('Error getting campaigns from Directus:', error);
      return [];
    }
  }

  async getCampaign(id: number): Promise<Campaign | undefined> {
    try {
      const response = await directusApi.get(`/items/user_campaigns/${id}`);
      
      if (!response.data?.data) {
        return undefined;
      }
      
      const item = response.data.data;
      return {
        id: item.id,
        name: item.name,
        description: item.description,
        userId: item.user_id,
        createdAt: new Date(item.created_at)
      };
    } catch (error) {
      console.error('Error getting campaign from Directus:', error);
      return undefined;
    }
  }

  /**
   * Получает кампанию по ID с настройками для социальных платформ
   * @param campaignId ID кампании
   * @param token Опциональный токен авторизации
   * @returns Объект кампании с настройками или null, если кампания не найдена
   */
  async getCampaignById(campaignId: string, token?: string): Promise<any> {
    try {
      console.log(`[DatabaseStorage] Получение кампании по ID: ${campaignId}`);
      
      // Используем напрямую directusApi, чтобы убедиться, что мы получим все поля, включая social_media_settings
      const authToken = token || process.env.DIRECTUS_STATIC_TOKEN;
      
      const response = await directusApi.get(`/items/user_campaigns/${campaignId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (!response.data?.data) {
        console.error(`[DatabaseStorage] Кампания с ID ${campaignId} не найдена`);
        return null;
      }
      
      const item = response.data.data;
      console.log(`[DatabaseStorage] Получена кампания: ${item.name}`);
      
      return item;
    } catch (error) {
      console.error(`[DatabaseStorage] Ошибка при получении кампании по ID ${campaignId}:`, error);
      return null;
    }
  }

  async createCampaign(campaign: InsertCampaign): Promise<Campaign> {
    try {
      const authToken = await this.getAuthToken(campaign.userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      const response = await directusApi.post('/items/user_campaigns', {
        name: campaign.name,
        description: campaign.description,
        user_id: campaign.userId
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      const item = response.data.data;
      return {
        id: item.id,
        name: item.name,
        description: item.description,
        userId: item.user_id,
        createdAt: new Date(item.created_at)
      };
    } catch (error) {
      console.error('Error creating campaign in Directus:', error);
      throw new Error('Failed to create campaign');
    }
  }

  async deleteCampaign(id: number): Promise<void> {
    try {
      // Нам нужен токен пользователя для этой операции
      // Сначала получаем кампанию через метод getCampaignById, который не требует userId
      
      // Преобразуем числовой id в строку для getCampaignById
      const campaign = await this.getCampaignById(id.toString());
      if (!campaign) {
        throw new Error('Campaign not found');
      }
      
      const authToken = await this.getAuthToken(campaign.userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      await directusApi.delete(`/items/user_campaigns/${id}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
    } catch (error) {
      console.error('Error deleting campaign from Directus:', error);
      throw new Error('Failed to delete campaign');
    }
  }
  
  // Вспомогательный метод для получения токена пользователя
  private async getAuthToken(userId: string | undefined): Promise<string | null> {
    if (!userId) return null;
    console.log('Getting auth token for user:', userId);

    try {
      // Сначала проверяем кэш
      const now = Date.now();
      if (this.tokenCache[userId] && this.tokenCache[userId].expiresAt > now) {
        console.log(`Using cached token for user ${userId}, expires in ${Math.round((this.tokenCache[userId].expiresAt - now) / 1000)} seconds`);
        return this.tokenCache[userId].token;
      }
      
      // Если в кэше нет или токен устарел, получаем новый
      console.log(`Token for user ${userId} not in cache or expired, fetching new one`);
      const tokenInfo = await this.getUserTokenInfo(userId);
      
      if (tokenInfo && tokenInfo.token) {
        // Сохраняем в кэш с временем жизни 50 минут
        this.tokenCache[userId] = {
          token: tokenInfo.token,
          expiresAt: now + 50 * 60 * 1000 // 50 минут
        };
        console.log(`Cached new token for user ${userId}, expires in 50 minutes`);
        return tokenInfo.token;
      }
      
      console.warn('No token found for user:', userId);
      return null;
    } catch (error) {
      console.error('Error getting auth token:', error);
      return null;
    }
  }
  
  /**
   * Получает токен авторизации администратора системы
   * @returns Токен администратора или null
   */
  async getAdminToken(): Promise<string | null> {
    try {
      // Получаем e-mail и пароль администратора из переменных окружения
      const email = process.env.DIRECTUS_EMAIL;
      const password = process.env.DIRECTUS_PASSWORD;
      
      if (!email || !password) {
        console.error('Отсутствуют учетные данные администратора (DIRECTUS_EMAIL, DIRECTUS_PASSWORD)');
        return null;
      }
      
      console.log(`Получение токена администратора для ${email}`);
      
      // Пытаемся авторизоваться как администратор
      const directusUrl = process.env.DIRECTUS_URL;
      const response = await axios.post(`${directusUrl}/auth/login`, {
        email,
        password
      });
      
      if (response?.data?.data?.access_token) {
        const token = response.data.data.access_token;
        console.log('Авторизация администратора успешна, получен токен');
        return token;
      } else {
        console.error('Не удалось получить токен администратора: неожиданный формат ответа');
        return null;
      }
    } catch (error) {
      console.error('Ошибка при получении токена администратора:', error);
      return null;
    }
  }

  // Campaign Content
  async getCampaignContent(userId: string, campaignId?: string): Promise<CampaignContent[]> {
    console.log('Fetching content for campaign ID:', campaignId);
    try {
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        console.error('No auth token found for user', userId);
        return [];
      }
      
      const filter: any = {
        user_id: {
          _eq: userId
        }
      };
      
      if (campaignId) {
        filter.campaign_id = {
          _eq: campaignId
        };
      }
      
      const response = await directusApi.get('/items/campaign_content', {
        params: {
          filter,
          sort: ['-created_at']
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      console.log('Found', response.data?.data?.length, 'content items for campaign', campaignId);
      
      const content = (response.data?.data || []).map((item: any) => ({
        id: item.id,
        content: item.content,
        userId: item.user_id,
        campaignId: item.campaign_id,
        status: item.status,
        postType: item.post_type,
        imageUrl: item.image_url,
        videoUrl: item.video_url,
        prompt: item.prompt || "",
        scheduledAt: item.scheduled_at ? new Date(item.scheduled_at) : null,
        publishedAt: item.published_at ? new Date(item.published_at) : null,
        createdAt: new Date(item.created_at),
        socialPlatforms: item.social_platforms,
        publishedPlatforms: item.published_platforms || []
      }));
      
      return content;
    } catch (error) {
      console.error('Error getting campaign content from Directus:', error);
      return [];
    }
  }

  /**
   * ПОЛЬЗОВАТЕЛЬСКОЕ чтение контента. Ходит РОВНО тем токеном, который передал
   * вызывающий, и никогда не эскалирует.
   *
   * Здесь была лесенка из четырёх попыток: свой токен → свой токен ещё раз →
   * перебор `tokenCache` ВСЕХ пользователей → анонимный запрос. Поскольку
   * `getAuthToken(любойUserId)` отдаёт `DIRECTUS_SERVICE_TOKEN`, третья попытка
   * означала «после 403 пользователя дочитать служебным токеном», то есть
   * пользовательский маршрут молча получал доступ к чужому арендатору
   * (cancel/status чужой публикации). Отказ пользовательского токена теперь
   * ОКОНЧАТЕЛЕН.
   *
   * Служебное чтение существует отдельно и называется явно —
   * `getCampaignContentByIdPrivileged`. Оно допустимо только после
   * подтверждённого ownership (`assertContentBelongsToRequester`) либо в фоновых
   * задачах, у которых пользовательской сессии нет по определению.
   */
  async getCampaignContentById(id: string, authToken?: string): Promise<CampaignContent | undefined> {
    if (!authToken) {
      // Без токена пользовательского чтения не бывает. Раньше отсюда начиналась
      // эскалация; молча отдавать служебный доступ нельзя.
      console.warn(`getCampaignContentById(${id}) вызван без токена — служебное чтение требует getCampaignContentByIdPrivileged`);
      return undefined;
    }
    return this.fetchCampaignContentWithToken(id, authToken);
  }

  /**
   * СЛУЖЕБНОЕ чтение контента сервисным токеном — читает любого арендатора.
   * Вызывать только после подтверждённого ownership или из фоновых задач.
   */
  async getCampaignContentByIdPrivileged(id: string): Promise<CampaignContent | undefined> {
    const serviceToken = await resolvePublishingToken();
    if (!serviceToken) {
      console.error(`getCampaignContentByIdPrivileged(${id}): служебный токен недоступен`);
      return undefined;
    }
    return this.fetchCampaignContentWithToken(id, serviceToken);
  }

  private async fetchCampaignContentWithToken(id: string, token: string): Promise<CampaignContent | undefined> {
    try {
      let response = null;

      try {
        response = await directusApi.get(`/items/campaign_content/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (error: any) {
        console.warn(`Не удалось получить контент ${id}: ${error.message}`);
        return undefined;
      }

      // Проверяем, получили ли мы данные
      if (!response || !response.data?.data) {
        console.warn(`Контент с ID ${id} не найден ни одним из способов`);
        return undefined;
      }
      
      const item = response.data.data;
      // Контент найден в Directus
      
      return {
        id: item.id,
        content: item.content,
        userId: item.user_id,
        campaign_id: item.campaign_id,
        campaignId: item.campaign_id,
        status: item.status,
        contentType: item.content_type || "text",
        title: item.title || null,
        imageUrl: item.image_url,
        videoUrl: item.video_url,
        prompt: item.prompt || "",
        scheduledAt: item.scheduled_at ? new Date(item.scheduled_at) : null,
        publishedAt: item.published_at ? new Date(item.published_at) : null,
        createdAt: new Date(item.created_at),
        socialPlatforms: item.social_platforms,
        publishedPlatforms: item.published_platforms || [],
        keywords: item.keywords || [] // Добавляем ключевые слова
      };
    } catch (error: any) {
      console.error(`Ошибка при получении контента с ID ${id}:`, error);
      
      // Добавляем подробную информацию об ошибке
      if (error.response) {
        console.error(`Статус ошибки: ${error.response.status}`);
        console.error(`Данные ошибки: ${JSON.stringify(error.response.data || {})}`);
      }
      
      // Если ошибка 403, логируем это
      if (error.response?.status === 403) {
        console.log(`Ошибка доступа 403 при получении контента ${id} - недостаточно прав`);
      }
      
      console.error('Error getting campaign content by ID from Directus:', error);
      return undefined;
    }
  }

  async createCampaignContent(content: InsertCampaignContent): Promise<CampaignContent> {
    try {
      const authToken = await this.getAuthToken(content.userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      // Преобразуем данные из нашей схемы в формат Directus
      const directusContent = {
        content: content.content,
        user_id: content.userId,
        campaign_id: content.campaignId,
        status: content.status,
        image_url: content.imageUrl,
        video_url: content.videoUrl,
        prompt: content.prompt || "",  // Добавляем поле промта при создании
        scheduled_at: toIsoOrNull(content.scheduledAt),
        social_platforms: content.socialPlatforms,
        title: content.title || "",
        content_type: content.contentType || "text",
        keywords: Array.isArray(content.keywords) ? content.keywords : [] // Добавляем ключевые слова при создании
      };
      
      const response = await directusApi.post('/items/campaign_content', directusContent, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      const item = response.data.data;
      return {
        id: item.id,
        content: item.content,
        userId: item.user_id,
        campaign_id: item.campaign_id,
        campaignId: item.campaign_id,
        status: item.status,
        contentType: item.content_type || "text",
        title: item.title || null,
        imageUrl: item.image_url,
        videoUrl: item.video_url,
        prompt: item.prompt || "",  // Добавляем поле промта при возвращении результата
        scheduledAt: item.scheduled_at ? new Date(item.scheduled_at) : null,
        publishedAt: item.published_at ? new Date(item.published_at) : null,
        createdAt: new Date(item.created_at),
        socialPlatforms: item.social_platforms,
        keywords: item.keywords || [], // Добавляем ключевые слова при возвращении результата
        additionalImages: Array.isArray(item.additional_images) ? item.additional_images : [], // Добавляем дополнительные изображения
        metadata: item.metadata || {} // КРИТИЧЕСКИ ВАЖНО: возвращаем metadata для Stories
      };
    } catch (error) {
      console.error('Error creating campaign content in Directus:', error);
      throw new Error('Failed to create campaign content');
    }
  }

  /**
   * ПОЛЬЗОВАТЕЛЬСКАЯ запись контента. Токен обязателен и используется как есть.
   *
   * Раньше при отсутствии токена метод сам находил владельца записи и брал
   * `getAuthToken(владелец)` — то есть служебный токен. Пользовательский handler
   * (`/api/publish/cancel/:id`), у которого прямой PATCH только что получил 403,
   * следом звал этот метод БЕЗ токена и дописывал чужую запись служебным
   * доступом. Служебная запись теперь называется явно —
   * `updateCampaignContentPrivileged`.
   */
  async updateCampaignContent(id: string, updates: Partial<InsertCampaignContent>, authToken?: string): Promise<CampaignContent> {
    if (!authToken) {
      throw new Error('updateCampaignContent requires an auth token; use updateCampaignContentPrivileged for background/service writes');
    }
    return this.patchCampaignContent(id, updates, authToken, false);
  }

  /**
   * СЛУЖЕБНАЯ запись контента сервисным токеном — пишет любого арендатора.
   * Вызывать только из фоновых задач или после подтверждённого ownership.
   */
  async updateCampaignContentPrivileged(id: string, updates: Partial<InsertCampaignContent>): Promise<CampaignContent> {
    const serviceToken = await resolvePublishingToken();
    if (!serviceToken) {
      throw new Error('No service token available for privileged content update');
    }
    return this.patchCampaignContent(id, updates, serviceToken, true);
  }

  private async patchCampaignContent(
    id: string,
    updates: Partial<InsertCampaignContent>,
    token: string,
    privileged: boolean,
  ): Promise<CampaignContent> {
    const authToken = token;
    try {
      // Подготовка заголовков для запроса
      const headers: Record<string, string> = { 'Authorization': `Bearer ${token}` };

      // Преобразуем данные из нашей схемы в формат Directus
      const directusUpdates: Record<string, any> = {};
      
      if (updates.content !== undefined) directusUpdates.content = updates.content;
      if (updates.status !== undefined) directusUpdates.status = updates.status;
      if (updates.contentType !== undefined) directusUpdates.content_type = updates.contentType;
      if (updates.title !== undefined) directusUpdates.title = updates.title;
      if (updates.imageUrl !== undefined) directusUpdates.image_url = updates.imageUrl;
      if (updates.videoUrl !== undefined) directusUpdates.video_url = updates.videoUrl;
      if (updates.prompt !== undefined) {
        console.log(`Обновляем промт контента ${id}: "${updates.prompt}"`);
        directusUpdates.prompt = updates.prompt;
      }
      if (updates.scheduledAt !== undefined) directusUpdates.scheduled_at = toIsoOrNull(updates.scheduledAt);
      if (updates.publishedAt !== undefined) directusUpdates.published_at = toIsoOrNull(updates.publishedAt);
      
      // КРИТИЧЕСКИ ВАЖНО: при обновлении socialPlatforms сохраняем существующие статусы опубликованных платформ
      if (updates.socialPlatforms !== undefined) {
        // Получаем текущие данные контента тем же уровнем доступа, что и запись
        const currentContent = privileged
          ? await this.getCampaignContentByIdPrivileged(id)
          : await this.getCampaignContentById(id, authToken);
        if (currentContent && currentContent.socialPlatforms) {
          const currentPlatforms = typeof currentContent.socialPlatforms === 'string' 
            ? JSON.parse(currentContent.socialPlatforms) 
            : currentContent.socialPlatforms;
          
          const newPlatforms = typeof updates.socialPlatforms === 'string'
            ? JSON.parse(updates.socialPlatforms)
            : updates.socialPlatforms;
          
          // Строим новый объект платформ: только выбранные + уже опубликованные (которых нет в новом выборе)
          const mergedPlatforms: Record<string, any> = {};

          // Шаг 1: добавляем выбранные платформы (с сохранением published-статуса)
          for (const [platform, newData] of Object.entries(newPlatforms)) {
            const currentData = currentPlatforms[platform];
            const newPlatformData = newData as any;

            if (currentData && currentData.status === 'published' && currentData.postUrl) {
              // Платформа уже опубликована — сохраняем её данные
              mergedPlatforms[platform] = {
                ...currentData,
                scheduledAt: newPlatformData.scheduledAt || currentData.scheduledAt
              };
            } else {
              mergedPlatforms[platform] = newPlatformData;
            }
          }

          // Шаг 2: сохраняем платформы, которые не в новом выборе, но уже опубликованы
          for (const [platform, currentData] of Object.entries(currentPlatforms) as [string, any][]) {
            if (!newPlatforms[platform] && currentData && currentData.status === 'published' && currentData.postUrl) {
              mergedPlatforms[platform] = currentData;
            }
          }

          directusUpdates.social_platforms = mergedPlatforms;
          console.log(`🔒 Платформы обновлены для контента ${id}: ${Object.keys(mergedPlatforms).join(', ')}`);
          console.log(`🔒 Опубликованные платформы сохранены:`, Object.entries(mergedPlatforms)
            .filter(([_, data]) => data.status === 'published')
            .map(([platform]) => platform));
        } else {
          // Если нет текущих данных, используем новые
          directusUpdates.social_platforms = updates.socialPlatforms;
        }
      }
      // Добавляем обработку дополнительных изображений
      if (updates.additionalImages !== undefined) {
        console.log(`Обновляем дополнительные изображения контента ${id}:`, updates.additionalImages);
        directusUpdates.additional_images = Array.isArray(updates.additionalImages) ? updates.additionalImages : [];
      }
      
      // Обработка ключевых слов (keywords)
      if (updates.keywords !== undefined) {
        console.log(`Обновляем ключевые слова контента ${id}:`, updates.keywords);
        directusUpdates.keywords = Array.isArray(updates.keywords) ? updates.keywords : [];
      }
      
      // КРИТИЧЕСКИ ВАЖНО: Обработка metadata для Stories
      if (updates.metadata !== undefined) {
        console.log(`🎬 Обновляем metadata для Stories контента ${id}:`, JSON.stringify(updates.metadata, null, 2));
        directusUpdates.metadata = updates.metadata;
      }
      
      // Выводим данные, которые будем отправлять
      console.log(`Отправляем обновление в Directus для контента ${id}:`, JSON.stringify(directusUpdates));
      
      const response = await directusApi.patch(`/items/campaign_content/${id}`, directusUpdates, { headers });
      
      console.log(`✅ Успешно обновлен контент ${id} в Directus, status: ${response.status}`);
      console.log(`📋 Ответ от Directus:`, JSON.stringify(response.data, null, 2));
      
      const item = response.data.data;
      return {
        id: item.id,
        content: item.content,
        userId: item.user_id,
        campaign_id: item.campaign_id,
        campaignId: item.campaign_id,
        status: item.status,
        contentType: item.content_type || "text",
        title: item.title || null,
        imageUrl: item.image_url,
        videoUrl: item.video_url,
        prompt: item.prompt || "",
        scheduledAt: item.scheduled_at ? new Date(item.scheduled_at) : null,
        publishedAt: item.published_at ? new Date(item.published_at) : null,
        createdAt: new Date(item.created_at),
        socialPlatforms: item.social_platforms,
        keywords: item.keywords || [], // Добавляем возврат ключевых слов
        additionalImages: Array.isArray(item.additional_images) ? item.additional_images : [], // Добавляем дополнительные изображения
        metadata: item.metadata || {} // КРИТИЧЕСКИ ВАЖНО: возвращаем metadata для Stories
      };
    } catch (error: any) {
      console.error('❌ Error updating campaign content in Directus:', error);
      if (error.response) {
        console.error('❌ Response status:', error.response.status);
        console.error('❌ Response data:', JSON.stringify(error.response.data, null, 2));
        console.error('❌ Response headers:', error.response.headers);
      } else if (error.request) {
        console.error('❌ No response received:', error.request);
      } else {
        console.error('❌ Error message:', error.message);
      }
      throw new Error(`Failed to update campaign content: ${error.message}`);
    }
  }

  async deleteCampaignContent(id: string): Promise<void> {
    try {
      // Получаем данные текущего контента для доступа к userId.
      // Служебное чтение названо явно: сессии владельца здесь нет.
      const content = await this.getCampaignContentByIdPrivileged(id);
      if (!content) {
        throw new Error('Content not found');
      }

      const authToken = await this.getAuthToken(content.userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      await directusApi.delete(`/items/campaign_content/${id}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
    } catch (error) {
      console.error('Error deleting campaign content from Directus:', error);
      throw new Error('Failed to delete campaign content');
    }
  }

  async getScheduledContent(userId?: string, campaignId?: string): Promise<CampaignContent[]> {
    try {
      let authToken: string | null = null;
      
      // Если указан userId, получаем токен для этого пользователя
      if (userId) {
        authToken = await this.getAuthToken(userId);
        console.log(`Получен токен для пользователя ${userId}: ${authToken ? 'Токен найден' : 'Токен не найден'}`);
      }
      
      // Если не указан userId или нет токена, выводим сообщение
      if (!authToken) {
        console.log('Получение запланированных публикаций, токен не найден в хранилище');
        // Возвращаем пустой массив вместо выполнения запроса с пустым токеном
        console.log('Пропускаем запрос к Directus API из-за отсутствия токена');
        return [];
      }
      
      const filter: any = {
        status: {
          _in: ['scheduled', 'partial', 'partially_published']
        },
        scheduled_at: {
          _nnull: true
        }
      };
      
      // Если указан userId, добавляем фильтр
      if (userId) {
        filter.user_id = {
          _eq: userId
        };
      }
      
      if (campaignId) {
        filter.campaign_id = {
          _eq: campaignId
        };
      }
      
      // Добавляем заголовок авторизации только если токен есть
      const headers: Record<string, string> = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await directusApi.get('/items/campaign_content', {
        params: {
          filter,
          sort: ['scheduled_at']
        },
        headers
      });
      
      const content = (response.data?.data || []).map((item: any) => ({
        id: item.id,
        content: item.content,
        userId: item.user_id,
        campaign_id: item.campaign_id,
        campaignId: item.campaign_id,
        status: item.status,
        contentType: item.content_type || "text",
        title: item.title || null,
        imageUrl: item.image_url,
        prompt: item.prompt || "",
        videoUrl: item.video_url,
        scheduledAt: item.scheduled_at ? new Date(item.scheduled_at) : null,
        publishedAt: item.published_at ? new Date(item.published_at) : null,
        createdAt: new Date(item.created_at),
        socialPlatforms: item.social_platforms,
        keywords: item.keywords || [], // Добавляем ключевые слова
        additionalImages: Array.isArray(item.additional_images) ? item.additional_images : [], // Добавляем дополнительные изображения
        metadata: item.metadata || {} // КРИТИЧЕСКИ ВАЖНО: возвращаем metadata для Stories
      }));
      
      return content;
    } catch (error) {
      console.error('Error getting scheduled content from Directus:', error);
      return [];
    }
  }

  async getScheduledCampaignContent(campaignId: string, userId: string, token?: string): Promise<CampaignContent[]> {
    try {
      console.log(`[Scheduled] Получение запланированных публикаций для кампании ${campaignId}, пользователя ${userId}`);
      console.log(`[Scheduled] Токен передан: ${token ? 'ДА' : 'НЕТ'}`);
      
      let authToken: string | null | undefined = token;

      // Если токен не передан, пытаемся получить из кэша
      if (!authToken) {
        console.log(`[Scheduled] Токен не передан, пытаемся получить из кэша`);
        authToken = await this.getAuthToken(userId);
        console.log(`Получен токен из кэша для пользователя ${userId}: ${authToken ? 'Токен найден' : 'Токен не найден'}`);
      } else {
        console.log(`[Scheduled] Используем переданный токен: YES`);
      }
      
      if (!authToken) {
        console.warn(`[Scheduled] Токен не найден для пользователя ${userId}`);
        return [];
      }
      
      const filter: any = {
        status: {
          _eq: 'scheduled'
        },
        scheduled_at: {
          _nnull: true
        },
        campaign_id: {
          _eq: campaignId
        },
        user_id: {
          _eq: userId
        }
      };
      
      const headers = {
        'Authorization': `Bearer ${authToken}`
      };
      
      console.log(`[Scheduled] Выполняется запрос к Directus с фильтром:`, JSON.stringify(filter, null, 2));
      
      const response = await directusApi.get('/items/campaign_content', {
        params: {
          filter,
          sort: ['scheduled_at']
        },
        headers
      });
      
      const items = response.data?.data || [];
      console.log(`[Scheduled] Получено ${items.length} элементов из Directus`);
      
      const content = items.map((item: any) => ({
        id: item.id,
        content: item.content,
        userId: item.user_id,
        campaign_id: item.campaign_id,
        campaignId: item.campaign_id,
        status: item.status,
        contentType: item.content_type || "text",
        title: item.title || null,
        imageUrl: item.image_url,
        prompt: item.prompt || "",
        videoUrl: item.video_url,
        scheduledAt: item.scheduled_at ? new Date(item.scheduled_at) : null,
        publishedAt: item.published_at ? new Date(item.published_at) : null,
        createdAt: new Date(item.created_at),
        socialPlatforms: item.social_platforms,
        keywords: item.keywords || [],
        additionalImages: Array.isArray(item.additional_images) ? item.additional_images : [],
        metadata: item.metadata || {} // КРИТИЧЕСКИ ВАЖНО: возвращаем metadata для Stories
      }));
      
      console.log(`[Scheduled] Возвращается ${content.length} запланированных публикаций`);
      return content;
    } catch (error: any) {
      console.error(`[Scheduled] Ошибка при получении запланированных публикаций:`, error);
      if (error.response) {
        console.error(`[Scheduled] Статус ошибки: ${error.response.status}`);
        console.error(`[Scheduled] Данные ошибки: ${JSON.stringify(error.response.data || {})}`);
      }
      return [];
    }
  }

  // Business Questionnaire методы
  async getBusinessQuestionnaire(campaignId: string, authToken?: string): Promise<BusinessQuestionnaire | null> {
    console.log('Getting business questionnaire for campaign:', campaignId);
    try {
      // Убедимся, что у нас есть токен авторизации
      if (!authToken) {
        console.error('No auth token provided for getting business questionnaire');
        return null;
      }
      
      console.log('Using authorization token for directus request');
      
      const filter = {
        campaign_id: {
          _eq: campaignId
        }
      };
      
      console.log('Requesting business questionnaire with filter:', JSON.stringify(filter));
      
      const response = await directusApi.get('/items/business_questionnaire', {
        params: {
          filter
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (!response.data?.data?.length) {
        console.log('No business questionnaire found for campaign', campaignId);
        return null;
      }
      
      const item = response.data.data[0];
      return {
        id: item.id,
        campaignId: item.campaign_id,
        companyName: item.company_name,
        contactInfo: item.contact_info,
        businessDescription: item.business_description,
        mainDirections: item.main_directions,
        brandImage: item.brand_image,
        productsServices: item.products_services,
        targetAudience: item.target_audience,
        customerResults: item.customer_results,
        companyFeatures: item.company_features,
        businessValues: item.business_values,
        productBeliefs: item.product_beliefs,
        competitiveAdvantages: item.competitive_advantages,
        marketingExpectations: item.marketing_expectations,
        createdAt: new Date(item.created_at)
      };
    } catch (error) {
      console.error('Error getting business questionnaire from Directus:', error);
      return null;
    }
  }
  
  async createBusinessQuestionnaire(questionnaire: any, authToken?: string): Promise<BusinessQuestionnaire> {
    // Универсальная функция-нормализатор: принимает и camelCase, и snake_case
    const getCampaignId = (q: any) => q.campaign_id || q.campaignId;
    const getBusinessName = (q: any) => q.business_name || q.businessName || q.companyName;
    const getContactInfo = (q: any) => q.contact_info || q.contactInfo;
    const getBusinessDescription = (q: any) => q.business_description || q.businessDescription;
    const getMainDirections = (q: any) => q.main_directions || q.mainDirections;
    const getBrandImage = (q: any) => q.brand_image || q.brandImage;
    const getProductsServices = (q: any) => q.products_services || q.productsServices;
    const getTargetAudience = (q: any) => q.target_audience || q.targetAudience;
    const getCustomerResults = (q: any) => q.customer_results || q.customerResults;
    const getCompanyFeatures = (q: any) => q.company_features || q.companyFeatures;
    const getBusinessValues = (q: any) => q.business_values || q.businessValues;
    const getProductBeliefs = (q: any) => q.product_beliefs || q.productBeliefs;
    const getCompetitiveAdvantages = (q: any) => q.competitive_advantages || q.competitiveAdvantages;
    const getMarketingExpectations = (q: any) => q.marketing_expectations || q.marketingExpectations;
    
    const campaignId = getCampaignId(questionnaire);
    console.log('Creating business questionnaire for campaign:', campaignId);
    console.log('[DEBUG] Входящий объект questionnaire:', JSON.stringify(questionnaire, null, 2));
    
    try {
      // Убедимся, что у нас есть токен авторизации
      if (!authToken) {
        console.error('No auth token provided for creating business questionnaire');
        throw new Error('Authentication token not found');
      }
      
      console.log('Using authorization token for directus request');
      
      // Проверяем наличие и формат campaign_id
      if (!campaignId || typeof campaignId !== 'string') {
        throw new Error('Invalid campaign ID');
      }
      
      // Нормализуем все данные в формат Directus (snake_case)
      const directusQuestionnaire = {
        campaign_id: campaignId,
        company_name: getBusinessName(questionnaire),
        contact_info: getContactInfo(questionnaire),
        business_description: getBusinessDescription(questionnaire),
        main_directions: getMainDirections(questionnaire),
        brand_image: getBrandImage(questionnaire),
        products_services: getProductsServices(questionnaire),
        target_audience: getTargetAudience(questionnaire),
        customer_results: getCustomerResults(questionnaire),
        company_features: getCompanyFeatures(questionnaire),
        business_values: getBusinessValues(questionnaire),
        product_beliefs: getProductBeliefs(questionnaire),
        competitive_advantages: getCompetitiveAdvantages(questionnaire),
        marketing_expectations: getMarketingExpectations(questionnaire)
      };
      
      console.log('[DEBUG] Объект для Directus:', JSON.stringify(directusQuestionnaire, null, 2));
      console.log('Sending questionnaire data to Directus');
      
      try {
        // Отправляем данные в Directus с токеном авторизации
        const response = await directusApi.post('/items/business_questionnaire', directusQuestionnaire, {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        
        // Успешный ответ
        console.log('Successfully created business questionnaire in Directus');
        return this.mapDirectusQuestionnaire(response.data.data);
      } catch (apiError: any) {
        // Подробный вывод ошибки
        console.error('Directus API Error details:', {
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          message: apiError.message,
          errors: apiError.response?.data?.errors
        });
        
        // Если ошибка 403 - скорее всего проблема с правами доступа
        if (apiError.response?.status === 403) {
          console.log('Access denied - не хватает прав доступа');
          throw new Error('Не хватает прав доступа для создания анкеты');
        }
        
        // Прокидываем ошибку дальше
        throw apiError;
      }
      
      // Ошибка: response не определен в этом месте, 
  // метод уже возвращает результат в блоке try выше
    } catch (error) {
      console.error('Error creating business questionnaire in Directus:', error);
      throw new Error('Failed to create business questionnaire');
    }
  }
  
  async updateBusinessQuestionnaire(id: string, updates: Partial<InsertBusinessQuestionnaire>, authToken?: string): Promise<BusinessQuestionnaire> {
    console.log('Updating business questionnaire:', id, updates);
    try {
      // Убедимся, что у нас есть токен авторизации
      if (!authToken) {
        console.error('No auth token provided for updating business questionnaire');
        throw new Error('Authentication token not found');
      }
      
      console.log('Using authorization token for directus update request');
      
      // Получаем текущую анкету, чтобы убедиться в ее существовании
      const currentQuestionnaire = await this.getBusinessQuestionnaireById(id, authToken);
      if (!currentQuestionnaire) {
        throw new Error('Business questionnaire not found');
      }
      
      // Преобразуем данные из нашей схемы в формат Directus
      const directusUpdates: any = {};
      
      if (updates.companyName !== undefined) directusUpdates.company_name = updates.companyName;
      if (updates.contactInfo !== undefined) directusUpdates.contact_info = updates.contactInfo;
      if (updates.businessDescription !== undefined) directusUpdates.business_description = updates.businessDescription;
      if (updates.mainDirections !== undefined) directusUpdates.main_directions = updates.mainDirections;
      if (updates.brandImage !== undefined) directusUpdates.brand_image = updates.brandImage;
      if (updates.productsServices !== undefined) directusUpdates.products_services = updates.productsServices;
      if (updates.targetAudience !== undefined) directusUpdates.target_audience = updates.targetAudience;
      if (updates.customerResults !== undefined) directusUpdates.customer_results = updates.customerResults;
      if (updates.companyFeatures !== undefined) directusUpdates.company_features = updates.companyFeatures;
      if (updates.businessValues !== undefined) directusUpdates.business_values = updates.businessValues;
      if (updates.productBeliefs !== undefined) directusUpdates.product_beliefs = updates.productBeliefs;
      if (updates.competitiveAdvantages !== undefined) directusUpdates.competitive_advantages = updates.competitiveAdvantages;
      if (updates.marketingExpectations !== undefined) directusUpdates.marketing_expectations = updates.marketingExpectations;
      
      // campaignId не может быть изменен
      
      console.log('Sending update data to Directus for ID:', id);
      
      const response = await directusApi.patch(`/items/business_questionnaire/${id}`, directusUpdates, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      const item = response.data.data;
      return {
        id: item.id,
        campaignId: item.campaign_id,
        companyName: item.company_name,
        contactInfo: item.contact_info,
        businessDescription: item.business_description,
        mainDirections: item.main_directions,
        brandImage: item.brand_image,
        productsServices: item.products_services,
        targetAudience: item.target_audience,
        customerResults: item.customer_results,
        companyFeatures: item.company_features,
        businessValues: item.business_values,
        productBeliefs: item.product_beliefs,
        competitiveAdvantages: item.competitive_advantages,
        marketingExpectations: item.marketing_expectations,
        createdAt: new Date(item.created_at)
      };
    } catch (error) {
      console.error('Error updating business questionnaire in Directus:', error);
      throw new Error('Failed to update business questionnaire');
    }
  }
  
  // Вспомогательный метод для получения бизнес-анкеты по ID
  // Вспомогательный метод для преобразования данных Directus в наш формат
  private mapDirectusQuestionnaire(item: any): BusinessQuestionnaire {
    return {
      id: item.id,
      campaignId: item.campaign_id,
      companyName: item.company_name,
      contactInfo: item.contact_info,
      businessDescription: item.business_description,
      mainDirections: item.main_directions,
      brandImage: item.brand_image,
      productsServices: item.products_services,
      targetAudience: item.target_audience,
      customerResults: item.customer_results,
      companyFeatures: item.company_features,
      businessValues: item.business_values,
      productBeliefs: item.product_beliefs,
      competitiveAdvantages: item.competitive_advantages,
      marketingExpectations: item.marketing_expectations,
      createdAt: new Date(item.created_at)
    };
  }
  
  private async getBusinessQuestionnaireById(id: string, authToken?: string): Promise<BusinessQuestionnaire | null> {
    try {
      // Проверяем, что у нас есть токен авторизации
      if (!authToken) {
        console.error('No auth token provided, cannot get business questionnaire by ID');
        return null;
      }
      
      console.log('Getting business questionnaire by ID:', id);
      
      const response = await directusApi.get(`/items/business_questionnaire/${id}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (!response.data?.data) {
        return null;
      }
      
      return this.mapDirectusQuestionnaire(response.data.data);
    } catch (error) {
      console.error('Error getting business questionnaire by ID from Directus:', error);
      return null;
    }
  }
  
  // Campaign Keywords методы
  async getCampaignKeywords(campaignId: string): Promise<CampaignKeyword[]> {
    console.log('Getting campaign keywords for campaign:', campaignId);
    try {
      // Необходимо получить userId из campaignId для авторизации
      const campaignIdNum = parseInt(campaignId, 10);
      let userId: string | null = null;
      
      if (!isNaN(campaignIdNum)) {
        const campaign = await this.getCampaign(campaignIdNum);
        if (campaign) {
          userId = campaign.userId;
        }
      }
      
      if (!userId) {
        console.error('Cannot determine user ID for getting campaign keywords');
        return [];
      }
      
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        console.error('No auth token found for user', userId);
        return [];
      }
      
      // Мы используем нашу собственную таблицу в PostgreSQL
      // SQL-запрос будет выполнен через API или напрямую через клиент БД
      const { data } = await directusApi.get('/custom/campaign_keywords', {
        params: {
          campaign_id: campaignId
        },
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      // Преобразуем данные из формата ответа в тип CampaignKeyword
      const keywords = (data || []).map((item: any) => ({
        id: item.id,
        campaignId: item.campaign_id,
        keyword: item.keyword,
        trendScore: item.trend_score,
        mentionsCount: item.mentions_count,
        lastChecked: new Date(item.last_checked),
        createdAt: new Date(item.created_at)
      }));
      
      console.log(`Found ${keywords.length} keywords for campaign ${campaignId}`);
      return keywords;
    } catch (error) {
      console.error('Error getting campaign keywords:', error);
      return [];
    }
  }

  async createCampaignKeyword(keyword: InsertCampaignKeyword): Promise<CampaignKeyword> {
    console.log('Creating campaign keyword:', keyword);
    try {
      // Необходимо получить userId из campaignId для авторизации
      const campaignIdStr = String(keyword.campaignId);
      const campaignIdNum = parseInt(campaignIdStr, 10);
      let userId: string | null = null;
      
      if (!isNaN(campaignIdNum)) {
        const campaign = await this.getCampaign(campaignIdNum);
        if (campaign) {
          userId = campaign.userId;
        }
      }
      
      if (!userId) {
        console.error('Cannot determine user ID for creating campaign keyword');
        throw new Error('User ID required for authentication');
      }
      
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      // Мы используем нашу собственную таблицу в PostgreSQL
      // SQL-запрос будет выполнен через API или напрямую через клиент БД
      const { data } = await directusApi.post('/custom/campaign_keywords', {
        campaign_id: keyword.campaignId,
        keyword: keyword.keyword,
        trend_score: keyword.trendScore || "0",
        mentions_count: keyword.mentionsCount || 0
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      // Преобразуем полученный ответ в тип CampaignKeyword
      return {
        id: data.id,
        campaignId: data.campaign_id,
        keyword: data.keyword,
        trendScore: data.trend_score,
        mentionsCount: data.mentions_count,
        lastChecked: new Date(data.last_checked),
        createdAt: new Date(data.created_at)
      };
    } catch (error) {
      console.error('Error creating campaign keyword:', error);
      
      // Проверяем, содержит ли ошибка информацию о дубликате ключевого слова
      const errorMessage = (error as any)?.response?.data?.error || (error as Error).message;
      if (errorMessage && (errorMessage.includes('Дубликат ключевого слова') || errorMessage.includes('duplicate'))) {
        throw new Error(`Дубликат ключевого слова: "${keyword.keyword}". Такое ключевое слово уже существует в данной кампании.`);
      }
      
      throw new Error('Failed to create campaign keyword');
    }
  }

  async deleteCampaignKeyword(id: string): Promise<void> {
    console.log('Deleting campaign keyword with ID:', id);
    try {
      // Сначала получаем keyword для определения campaignId и userId
      const { data } = await directusApi.get(`/custom/campaign_keywords/${id}`);
      if (!data) {
        throw new Error('Keyword not found');
      }
      
      const campaignId = data.campaign_id;
      
      // Получаем userId из campaign
      const campaignIdNum = parseInt(campaignId, 10);
      let userId: string | null = null;
      
      if (!isNaN(campaignIdNum)) {
        const campaign = await this.getCampaign(campaignIdNum);
        if (campaign) {
          userId = campaign.userId;
        }
      }
      
      if (!userId) {
        console.error('Cannot determine user ID for deleting campaign keyword');
        throw new Error('User ID required for authentication');
      }
      
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      // Удаляем ключевое слово из таблицы
      await directusApi.delete(`/custom/campaign_keywords/${id}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      console.log(`Successfully deleted campaign keyword with ID ${id}`);
    } catch (error) {
      console.error('Error deleting campaign keyword:', error);
      throw new Error('Failed to delete campaign keyword');
    }
  }

  async updateCampaignKeyword(id: string, updates: Partial<InsertCampaignKeyword>): Promise<CampaignKeyword> {
    console.log('Updating campaign keyword:', id, updates);
    try {
      // Сначала получаем keyword для определения campaignId и userId
      const { data: keywordData } = await directusApi.get(`/custom/campaign_keywords/${id}`);
      if (!keywordData) {
        throw new Error('Keyword not found');
      }
      
      const campaignId = keywordData.campaign_id;
      
      // Получаем userId из campaign
      const campaignIdNum = parseInt(campaignId, 10);
      let userId: string | null = null;
      
      if (!isNaN(campaignIdNum)) {
        const campaign = await this.getCampaign(campaignIdNum);
        if (campaign) {
          userId = campaign.userId;
        }
      }
      
      if (!userId) {
        console.error('Cannot determine user ID for updating campaign keyword');
        throw new Error('User ID required for authentication');
      }
      
      const authToken = await this.getAuthToken(userId);
      if (!authToken) {
        throw new Error('No auth token found for user');
      }
      
      // Подготавливаем объект обновления
      const updateData: any = {};
      if (updates.keyword !== undefined) updateData.keyword = updates.keyword;
      if (updates.trendScore !== undefined) updateData.trend_score = updates.trendScore;
      if (updates.mentionsCount !== undefined) updateData.mentions_count = updates.mentionsCount;
      
      // Обновляем ключевое слово
      const { data } = await directusApi.patch(`/custom/campaign_keywords/${id}`, updateData, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      // Преобразуем полученный ответ в тип CampaignKeyword
      return {
        id: data.id,
        campaignId: data.campaign_id,
        keyword: data.keyword,
        trendScore: data.trend_score,
        mentionsCount: data.mentions_count,
        lastChecked: new Date(data.last_checked),
        createdAt: new Date(data.created_at)
      };
    } catch (error) {
      console.error('Error updating campaign keyword:', error);
      
      // Проверяем, содержит ли ошибка информацию о дубликате ключевого слова
      const errorMessage = (error as any)?.response?.data?.error || (error as Error).message;
      if (errorMessage && (errorMessage.includes('Дубликат ключевого слова') || errorMessage.includes('duplicate'))) {
        throw new Error(`Дубликат ключевого слова. Такое ключевое слово уже существует в данной кампании.`);
      }
      
      throw new Error('Failed to update campaign keyword');
    }
  }

  // Smart Bot Experience Management - In-Memory Implementation
  private botExperiences: BotExperience[] = [];
  private botPatterns: BotPattern[] = [];
  private nextBotExperienceId = 1;
  private nextBotPatternId = 1;

  // Временное хранилище попыток до записи результата
  private pendingAttempts: Map<string, BotActionAttempt> = new Map();

  async recordBotAttempt(attempt: BotActionAttempt): Promise<BotExperience> {
    // Сохраняем попытку во временном хранилище
    this.pendingAttempts.set(attempt.traceId, attempt);
    console.log(`[SmartBot] Recorded attempt: ${attempt.actionName} - ${attempt.traceId}`);
    
    // Возвращаем placeholder experience (не сохраняем в основную коллекцию пока нет результата)
    return {
      id: `pending_${attempt.traceId}`,
      traceId: attempt.traceId,
      actionName: attempt.actionName,
      contextSignature: attempt.contextSignature,
      params: attempt.params,
      outcomeType: 'fail',
      errorCode: null,
      errorDetails: null,
      durationMs: 0,
      reward: 0,
      createdAt: attempt.startTime
    };
  }

  async recordBotOutcome(outcome: BotActionOutcome): Promise<BotExperience> {
    // Получаем попытку из временного хранилища
    const attempt = this.pendingAttempts.get(outcome.traceId);
    
    if (!attempt) {
      // Если попытка не найдена, создаем experience только с результатом
      console.warn(`[SmartBot] No pending attempt found for traceId: ${outcome.traceId}`);
    }

    // Создаем полноценный experience с результатом
    const experience: BotExperience = {
      id: `exp_${this.nextBotExperienceId++}`,
      traceId: outcome.traceId,
      actionName: outcome.actionName,
      contextSignature: outcome.contextSignature,
      params: outcome.params,
      outcomeType: outcome.outcomeType,
      errorCode: outcome.errorCode || null,
      errorDetails: outcome.errorDetails || null,
      durationMs: outcome.durationMs,
      reward: outcome.reward,
      createdAt: outcome.endTime
    };

    this.botExperiences.push(experience);
    
    // Удаляем из временного хранилища
    this.pendingAttempts.delete(outcome.traceId);

    console.log(`[SmartBot] Recorded outcome: ${outcome.actionName} - ${outcome.outcomeType} (reward: ${outcome.reward})`);
    
    // Обновляем паттерны для всех исходов (успешных и неуспешных)
    await this.updateOrCreatePattern(outcome);
    
    return experience;
  }

  private async updateOrCreatePattern(outcome: BotActionOutcome): Promise<void> {
    const existingPatternIndex = this.botPatterns.findIndex(pattern =>
      pattern.actionName === outcome.actionName &&
      pattern.contextSignature === outcome.contextSignature &&
      JSON.stringify(pattern.params) === JSON.stringify(outcome.params)
    );

    if (existingPatternIndex !== -1) {
      // Обновляем существующий паттерн
      const pattern = this.botPatterns[existingPatternIndex];
      pattern.trials++;
      if (outcome.outcomeType === 'success') {
        pattern.successes++;
      }
      pattern.score = pattern.successes / pattern.trials;
      pattern.lastUsedAt = new Date();
      pattern.updatedAt = new Date();
    } else {
      // Создаем новый паттерн
      const newPattern: BotPattern = {
        id: `pat_${this.nextBotPatternId++}`,
        actionName: outcome.actionName,
        contextSignature: outcome.contextSignature,
        params: outcome.params,
        trials: 1,
        successes: outcome.outcomeType === 'success' ? 1 : 0,
        score: outcome.outcomeType === 'success' ? 1.0 : 0.0,
        lastUsedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.botPatterns.push(newPattern);
      console.log(`[SmartBot] Created new pattern: ${outcome.actionName} - score: ${newPattern.score}`);
    }
  }

  async getBotExperiences(actionName?: string, contextSignature?: string): Promise<BotExperience[]> {
    let filtered = this.botExperiences;

    if (actionName) {
      filtered = filtered.filter(exp => exp.actionName === actionName);
    }

    if (contextSignature) {
      filtered = filtered.filter(exp => exp.contextSignature === contextSignature);
    }

    return filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getTopBotPatterns(actionName: string, contextSignature?: string, limit = 5): Promise<BotPattern[]> {
    let filtered = this.botPatterns.filter(pattern => 
      pattern.actionName === actionName && pattern.successes > 0
    );

    if (contextSignature) {
      filtered = filtered.filter(pattern => 
        pattern.contextSignature === contextSignature ||
        this.isContextSimilar(pattern.contextSignature, contextSignature)
      );
    }

    return filtered
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async findSimilarContexts(actionName: string, contextSignature: string, limit = 3): Promise<BotPattern[]> {
    const patterns = this.botPatterns.filter(pattern => 
      pattern.actionName === actionName &&
      pattern.contextSignature !== contextSignature &&
      this.isContextSimilar(pattern.contextSignature, contextSignature) &&
      pattern.successes > 0
    );

    return patterns
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private isContextSimilar(context1: string, context2: string): boolean {
    // Простая логика определения схожести контекстов
    // В будущем можно улучшить с помощью более сложных алгоритмов
    const prefix1 = context1.split('_')[0];
    const prefix2 = context2.split('_')[0];
    return prefix1 === prefix2;
  }

  async incrementPatternStats(patternId: string, success: boolean): Promise<BotPattern> {
    const patternIndex = this.botPatterns.findIndex(p => p.id === patternId);
    if (patternIndex === -1) {
      throw new Error(`Pattern not found: ${patternId}`);
    }

    const pattern = this.botPatterns[patternIndex];
    pattern.trials++;
    if (success) {
      pattern.successes++;
    }
    pattern.score = pattern.successes / pattern.trials;
    pattern.lastUsedAt = new Date();
    pattern.updatedAt = new Date();

    console.log(`[SmartBot] Updated pattern stats: ${patternId} - score: ${pattern.score}`);
    return pattern;
  }

  async createOrUpdateBotPattern(patternData: Partial<InsertBotPattern>): Promise<BotPattern> {
    if (!patternData.actionName || !patternData.contextSignature || !patternData.params) {
      throw new Error('Missing required pattern data');
    }

    const existingPatternIndex = this.botPatterns.findIndex(pattern =>
      pattern.actionName === patternData.actionName &&
      pattern.contextSignature === patternData.contextSignature &&
      JSON.stringify(pattern.params) === JSON.stringify(patternData.params)
    );

    if (existingPatternIndex !== -1) {
      // Обновляем существующий паттерн
      const pattern = this.botPatterns[existingPatternIndex];
      pattern.trials = patternData.trials || pattern.trials;
      pattern.successes = patternData.successes || pattern.successes;
      pattern.score = patternData.score || (pattern.successes / pattern.trials);
      pattern.lastUsedAt = patternData.lastUsedAt || new Date();
      pattern.updatedAt = new Date();
      return pattern;
    } else {
      // Создаем новый паттерн
      const newPattern: BotPattern = {
        id: `pat_${this.nextBotPatternId++}`,
        actionName: patternData.actionName,
        contextSignature: patternData.contextSignature,
        params: patternData.params,
        trials: patternData.trials || 0,
        successes: patternData.successes || 0,
        score: patternData.score || 0,
        lastUsedAt: patternData.lastUsedAt || null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.botPatterns.push(newPattern);
      return newPattern;
    }
  }

  async cleanupOldExperiences(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const initialCount = this.botExperiences.length;
    this.botExperiences = this.botExperiences.filter(exp => 
      exp.createdAt > cutoffDate
    );

    const removedCount = initialCount - this.botExperiences.length;
    console.log(`[SmartBot] Cleaned up ${removedCount} old experiences (older than ${olderThanDays} days)`);
    return removedCount;
  }
}

export const storage = new DatabaseStorage();
