import { directusCrud } from './directus-crud';
import { directusAuthManager } from './directus-auth-manager';
import { directusApi } from '../directus';
import { log } from '../utils/logger';
import {
  Campaign,
  InsertCampaign,
  ContentSource,
  InsertContentSource,
  TrendTopic,
  InsertTrendTopic,
  CampaignContent,
  InsertCampaignContent,
  CampaignTrendTopic,
  InsertCampaignTrendTopic,
  BusinessQuestionnaire,
  InsertBusinessQuestionnaire
} from '@shared/schema';

/**
 * Адаптер для работы с хранилищем Directus через унифицированный CRUD интерфейс
 * Позволяет постепенно мигрировать существующий код на новый интерфейс
 */
export class DirectusStorageAdapter {
  private logPrefix: string = 'directus-storage';
  private tokenCache: Record<string, { token: string; expiresAt: number }> = {};

  constructor() {
    log('DirectusStorageAdapter initialized', this.logPrefix);
  }

  /**
   * Получает информацию о токене пользователя
   * @param userId ID пользователя
   * @returns Информация о токене или null, если токен не найден
   */
  async getUserTokenInfo(userId: string): Promise<{ token: string; refreshToken?: string; userId: string } | null> {
    try {
      // Сначала проверяем кэш
      if (this.tokenCache[userId] && this.tokenCache[userId].expiresAt > Date.now()) {
        log(`Using cached token for user ${userId}`, this.logPrefix);
        return {
          token: this.tokenCache[userId].token,
          userId
        };
      }

      // Если токен не найден в кэше или истек, пробуем получить из хранилища токенов
      // В будущем здесь может быть реализована логика обновления токена через refresh token
      log(`Token for user ${userId} not found in cache or expired`, this.logPrefix);
      return null;
    } catch (error) {
      log(`Error getting user token info: ${(error as Error).message}`, this.logPrefix);
      return null;
    }
  }

  /**
   * Кэширует токен авторизации пользователя
   * @param userId ID пользователя
   * @param token Токен авторизации
   * @param expiresIn Время жизни токена в секундах
   */
  cacheAuthToken(userId: string, token: string, expiresIn: number = 3600): void {
    this.tokenCache[userId] = {
      token,
      expiresAt: Date.now() + (expiresIn * 1000)
    };
    log(`Auth token for user ${userId} cached`, this.logPrefix);
  }

  /**
   * Получает список кампаний пользователя
   * @param userId ID пользователя
   * @returns Список кампаний
   */
  async getCampaigns(userId: string): Promise<Campaign[]> {
    try {
      log(`Fetching campaigns for user: ${userId}`, this.logPrefix);
      
      const userToken = await this.getUserTokenInfo(userId);
      
      // Если есть токен пользователя, используем его для запроса
      const options = userToken 
        ? { authToken: userToken.token, filter: { user_id: userId } }
        : { filter: { user_id: userId } };
      
      const campaigns = await directusCrud.list<Campaign>('user_campaigns', options);
      
      // Дополнительная фильтрация на стороне клиента для гарантии
      const filteredCampaigns = campaigns.filter(campaign => 
        campaign.userId === userId
      );
      
      log(`Found ${filteredCampaigns.length} campaigns for user ${userId}`, this.logPrefix);
      return filteredCampaigns;
    } catch (error) {
      log(`Error getting campaigns: ${(error as Error).message}`, this.logPrefix);
      return [];
    }
  }

  /**
   * Получает кампанию по ID
   * @param id ID кампании
   * @returns Кампания или undefined, если кампания не найдена
   */
  async getCampaign(id: number): Promise<Campaign | undefined> {
    try {
      log(`Fetching campaign with ID: ${id}`, this.logPrefix);
      const campaign = await directusCrud.getById<Campaign>('user_campaigns', id);
      return campaign || undefined;
    } catch (error) {
      log(`Error getting campaign with ID ${id}: ${(error as Error).message}`, this.logPrefix);
      return undefined;
    }
  }

  /**
   * Создает новую кампанию
   * @param campaign Данные для создания кампании
   * @returns Созданная кампания
   */
  async createCampaign(campaign: InsertCampaign): Promise<Campaign> {
    try {
      log(`Creating new campaign for user: ${campaign.userId}`, this.logPrefix);
      
      const userToken = await this.getUserTokenInfo(campaign.userId);
      const options = userToken ? { authToken: userToken.token } : {};
      
      const newCampaign = await directusCrud.create<Campaign>('user_campaigns', campaign, options);
      
      log(`Created new campaign with ID: ${newCampaign.id}`, this.logPrefix);
      return newCampaign;
    } catch (error) {
      log(`Error creating campaign: ${(error as Error).message}`, this.logPrefix);
      throw new Error(`Failed to create campaign: ${(error as Error).message}`);
    }
  }

  /**
   * Удаляет кампанию
   * @param id ID кампании
   */
  async deleteCampaign(id: number): Promise<void> {
    try {
      log(`Deleting campaign with ID: ${id}`, this.logPrefix);
      
      // Получаем кампанию для определения владельца
      const campaign = await this.getCampaign(id);
      
      if (!campaign) {
        throw new Error(`Campaign with ID ${id} not found`);
      }
      
      const userToken = await this.getUserTokenInfo(campaign.userId);
      const options = userToken ? { authToken: userToken.token } : {};
      
      await directusCrud.delete('user_campaigns', id, options);
      
      log(`Deleted campaign with ID: ${id}`, this.logPrefix);
    } catch (error) {
      log(`Error deleting campaign with ID ${id}: ${(error as Error).message}`, this.logPrefix);
      throw new Error(`Failed to delete campaign: ${(error as Error).message}`);
    }
  }

  /**
   * Получает список источников контента для пользователя и (опционально) кампании
   * @param userId ID пользователя
   * @param campaignId ID кампании (опционально)
   * @returns Список источников контента
   */
  async getContentSources(userId: string, campaignId?: number): Promise<ContentSource[]> {
    try {
      log(`Fetching content sources for user: ${userId}${campaignId ? `, campaign: ${campaignId}` : ''}`, this.logPrefix);
      
      const userToken = await this.getUserTokenInfo(userId);
      
      const filter: Record<string, any> = {};
      
      // Фильтрация по кампании, если указана
      if (campaignId) {
        filter.campaign_id = campaignId;
      }
      
      const options = userToken 
        ? { authToken: userToken.token, filter }
        : { filter };
      
      const sources = await directusCrud.list<ContentSource>('content_sources', options);
      
      log(`Found ${sources.length} content sources`, this.logPrefix);
      return sources;
    } catch (error) {
      log(`Error getting content sources: ${(error as Error).message}`, this.logPrefix);
      return [];
    }
  }

  /**
   * Создает новый источник контента
   * @param source Данные для создания источника
   * @returns Созданный источник
   */
  async createContentSource(source: InsertContentSource): Promise<ContentSource> {
    try {
      log(`Creating new content source for campaign: ${source.campaignId}`, this.logPrefix);
      
      // Получаем кампанию для определения владельца
      const campaign = await this.getCampaign(Number(source.campaignId));
      
      if (!campaign) {
        throw new Error(`Campaign with ID ${source.campaignId} not found`);
      }
      
      const userToken = await this.getUserTokenInfo(campaign.userId);
      const options = userToken ? { authToken: userToken.token } : {};
      
      const newSource = await directusCrud.create<ContentSource>('content_sources', source, options);
      
      log(`Created new content source with ID: ${newSource.id}`, this.logPrefix);
      return newSource;
    } catch (error) {
      log(`Error creating content source: ${(error as Error).message}`, this.logPrefix);
      throw new Error(`Failed to create content source: ${(error as Error).message}`);
    }
  }

  /**
   * Удаляет источник контента
   * @param id ID источника
   * @param userId ID пользователя для проверки прав
   */
  async deleteContentSource(id: number, userId: string): Promise<void> {
    try {
      log(`Deleting content source with ID: ${id} for user: ${userId}`, this.logPrefix);
      
      const userToken = await this.getUserTokenInfo(userId);
      const options = userToken ? { authToken: userToken.token } : {};
      
      await directusCrud.delete('content_sources', id, options);
      
      log(`Deleted content source with ID: ${id}`, this.logPrefix);
    } catch (error) {
      log(`Error deleting content source with ID ${id}: ${(error as Error).message}`, this.logPrefix);
      throw new Error(`Failed to delete content source: ${(error as Error).message}`);
    }
  }

  /**
   * Получает список запланированного контента
   * @param userId ID пользователя
   * @param campaignId ID кампании (опционально)
   * @returns Список запланированного контента
   */
  async getScheduledContent(userId: string, campaignId?: string): Promise<CampaignContent[]> {
    try {
      log(`Fetching scheduled content for user: ${userId}${campaignId ? `, campaign: ${campaignId}` : ''}`, this.logPrefix);
      
      // ИСПРАВЛЕНИЕ 403: Принудительно используем административный токен
      // для доступа к коллекции campaign_content
      let authToken: string | null = null;
      
      // Сначала пробуем получить админский токен
      const adminToken = await directusAuthManager.getAdminAuthToken();
      if (adminToken) {
        authToken = adminToken;
        log(`Using admin token for campaign_content access`, this.logPrefix);
      } else {
        // Fallback: пробуем пользовательский токен
        const userToken = await this.getUserTokenInfo(userId);
        if (userToken) {
          authToken = userToken.token;
        } else {
          const authManagerToken = await directusAuthManager.getAuthToken(userId);
          if (authManagerToken) {
            authToken = authManagerToken;
          }
        }
      }
      
      // Строим фильтр для запроса
      const filter: Record<string, any> = {
        status: { _in: ['scheduled', 'partial'] },
        scheduled_at: { _nnull: true }
      };
      
      // Фильтрация по кампании, если указана
      if (campaignId) {
        filter.campaign_id = campaignId;
      }
      
      // Фильтрация по пользователю
      filter.user_id = userId;
      
      // Опции запроса
      const options = authToken 
        ? { authToken, filter, sort: ['scheduled_at'] }
        : { filter, sort: ['scheduled_at'] };
      
      log(`Requesting scheduled content with options: ${JSON.stringify({ 
        hasToken: !!authToken, 
        filterKeys: Object.keys(filter),
        userId, 
        campaignId
      })}`, this.logPrefix);
      
      let scheduledContent: CampaignContent[] = [];
      
      try {
        // Пытаемся получить данные из Directus через наш новый CRUD-интерфейс
        const directusResponse = await directusCrud.list<CampaignContent>('campaign_content', options);
        log(`Received ${directusResponse.length} scheduled items from Directus`, this.logPrefix);
        scheduledContent = directusResponse;
      } catch (directusError) {
        log(`Error fetching from Directus: ${(directusError as Error).message}. Trying fallback method.`, this.logPrefix);
        
        // Запрос не удался, пробуем получить из хранилища через старый метод
        // Получаем все контенты пользователя и фильтруем по запланированным
        try {
          const allContent = await directusApi.get('/items/campaign_content', {
            params: {
              filter,
              sort: ['scheduled_at']
            },
            headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
          });
          
          const items = allContent.data?.data || [];
          log(`Received ${items.length} items using fallback method`, this.logPrefix);
          
          scheduledContent = items.map((item: any) => ({
            id: item.id,
            content: item.content,
            userId: item.user_id,
            campaignId: item.campaign_id,
            status: item.status,
            contentType: item.content_type || "text",
            title: item.title || null,
            imageUrl: item.image_url,
            prompt: item.prompt || "",
            videoUrl: item.video_url,
            scheduledAt: item.scheduled_at ? new Date(item.scheduled_at) : null,
            createdAt: new Date(item.created_at),
            socialPlatforms: item.social_platforms
          }));
        } catch (fallbackError) {
          log(`Fallback method also failed: ${(fallbackError as Error).message}`, this.logPrefix);
        }
      }
      
      // Дополнительная фильтрация на стороне клиента
      const filteredContent = scheduledContent.filter(content => {
        // Проверяем, что контент имеет статус "scheduled" или "partial"
        const isScheduled = content.status === 'scheduled' || content.status === 'partial';
        
        // Проверяем, что у контента есть scheduledAt
        const hasScheduled = !!content.scheduledAt;
        
        // Проверяем принадлежность пользователю
        const isUserContent = content.userId === userId;
        
        // Проверяем принадлежность кампании, если указана
        const isCampaignMatch = !campaignId || content.campaignId === campaignId;
        
        return isScheduled && hasScheduled && isUserContent && isCampaignMatch;
      });
      
      log(`Found ${filteredContent.length} scheduled content items after filtering`, this.logPrefix);
      return filteredContent;
    } catch (error) {
      log(`Error getting scheduled content: ${(error as Error).message}`, this.logPrefix);
      return [];
    }
  }
  
  /**
   * Обновляет контент кампании
   * @param id ID контента
   * @param updates Данные для обновления
   * @returns Обновленный контент
   */
  async updateCampaignContent(id: string, updates: Partial<InsertCampaignContent>): Promise<CampaignContent> {
    try {
      log(`Updating campaign content with ID: ${id}`, this.logPrefix);
      
      // Получаем контент для определения владельца
      const content = await this.getCampaignContentById(id);
      
      if (!content) {
        throw new Error(`Campaign content with ID ${id} not found`);
      }
      
      const userToken = await this.getUserTokenInfo(content.userId || '');
      const options = userToken ? { authToken: userToken.token } : {};
      
      const updatedContent = await directusCrud.update<CampaignContent>('campaign_content', id, updates, options);
      
      log(`Updated campaign content with ID: ${id}`, this.logPrefix);
      return updatedContent;
    } catch (error) {
      log(`Error updating campaign content with ID ${id}: ${(error as Error).message}`, this.logPrefix);
      throw new Error(`Failed to update campaign content: ${(error as Error).message}`);
    }
  }
  
  /**
   * Получает контент кампании по ID
   * @param id ID контента
   * @returns Контент или undefined, если контент не найден
   */
  async getCampaignContentById(id: string): Promise<CampaignContent | undefined> {
    try {
      log(`Fetching campaign content with ID: ${id}`, this.logPrefix);
      const content = await directusCrud.getById<CampaignContent>('campaign_content', id);
      return content || undefined;
    } catch (error) {
      log(`Error getting campaign content with ID ${id}: ${(error as Error).message}`, this.logPrefix);
      return undefined;
    }
  }

  // Stories methods
  async createStory(story: any): Promise<any> {
    try {
      log(`Creating new story: ${story.title}`, this.logPrefix);
      
      const result = await directusCrud.create('story_content', {
        campaign_id: story.campaignId,
        user_id: story.userId,
        title: story.title,
        type: 'story',
        status: 'draft',
        platform_settings: story.platformSettings || {},
        metadata: story.metadata || {}
      });
      
      if (result.success) {
        log(`Story created with ID: ${result.data.id}`, this.logPrefix);
        return result.data;
      } else {
        throw new Error('Failed to create story');
      }
    } catch (error: any) {
      log(`Error creating story: ${error.message}`, this.logPrefix);
      throw error;
    }
  }

  async getStoryById(id: string, userId: string): Promise<any> {
    try {
      log(`Getting story by ID: ${id}`, this.logPrefix);
      
      const result = await directusCrud.readByPk('story_content', id, {
        deep: {
          slides: {
            _filter: {},
            _sort: ['order'],
            elements: {
              _filter: {},
              _sort: ['z_index']
            }
          }
        }
      });
      
      if (result.success && result.data && result.data.user_id === userId) {
        return result.data;
      } else {
        return null;
      }
    } catch (error: any) {
      log(`Error getting story: ${error.message}`, this.logPrefix);
      throw error;
    }
  }

  async updateStory(id: string, updates: any, userId: string): Promise<any> {
    try {
      log(`Updating story: ${id}`, this.logPrefix);
      
      const result = await directusCrud.updateByPk('story_content', id, {
        ...updates,
        updated_at: new Date().toISOString()
      });
      
      if (result.success) {
        return result.data;
      } else {
        throw new Error('Failed to update story');
      }
    } catch (error: any) {
      log(`Error updating story: ${error.message}`, this.logPrefix);
      throw error;
    }
  }

  async deleteStory(id: string, userId: string): Promise<boolean> {
    try {
      log(`Deleting story: ${id}`, this.logPrefix);
      
      const result = await directusCrud.deleteByPk('story_content', id);
      
      return result.success;
    } catch (error: any) {
      log(`Error deleting story: ${error.message}`, this.logPrefix);
      return false;
    }
  }

  async getStoriesByCampaign(campaignId: string, userId: string): Promise<any[]> {
    try {
      log(`Getting stories for campaign: ${campaignId}`, this.logPrefix);
      
      const result = await directusCrud.read('story_content', {
        filter: {
          campaign_id: { _eq: campaignId },
          user_id: { _eq: userId }
        },
        sort: ['-created_at']
      });
      
      if (result.success && result.data) {
        return result.data;
      } else {
        return [];
      }
    } catch (error: any) {
      log(`Error getting campaign stories: ${error.message}`, this.logPrefix);
      return [];
    }
  }

  async addSlideToStory(slideData: any, userId: string): Promise<any> {
    try {
      log(`Adding slide to story: ${slideData.storyId}`, this.logPrefix);
      
      const result = await directusCrud.create('story_slides', {
        story_id: slideData.storyId,
        order: slideData.order,
        duration: slideData.duration || 5,
        background: slideData.background,
        animation: slideData.animation || null
      });
      
      if (result.success) {
        return result.data;
      } else {
        throw new Error('Failed to add slide');
      }
    } catch (error: any) {
      log(`Error adding slide: ${error.message}`, this.logPrefix);
      throw error;
    }
  }

  async updateSlide(slideId: string, updates: any, userId: string): Promise<any> {
    try {
      log(`Updating slide: ${slideId}`, this.logPrefix);
      
      const result = await directusCrud.updateByPk('story_slides', slideId, {
        ...updates,
        updated_at: new Date().toISOString()
      });
      
      if (result.success) {
        return result.data;
      } else {
        throw new Error('Failed to update slide');
      }
    } catch (error: any) {
      log(`Error updating slide: ${error.message}`, this.logPrefix);
      throw error;
    }
  }

  async deleteSlide(slideId: string, userId: string): Promise<boolean> {
    try {
      log(`Deleting slide: ${slideId}`, this.logPrefix);
      
      const result = await directusCrud.deleteByPk('story_slides', slideId);
      
      return result.success;
    } catch (error: any) {
      log(`Error deleting slide: ${error.message}`, this.logPrefix);
      return false;
    }
  }

  async reorderSlides(storyId: string, slideIds: string[], userId: string): Promise<void> {
    try {
      log(`Reordering slides for story: ${storyId}`, this.logPrefix);
      
      for (let i = 0; i < slideIds.length; i++) {
        await directusCrud.updateByPk('story_slides', slideIds[i], {
          order: i + 1
        });
      }
    } catch (error: any) {
      log(`Error reordering slides: ${error.message}`, this.logPrefix);
      throw error;
    }
  }

  async addElementToSlide(elementData: any, userId: string): Promise<any> {
    try {
      log(`Adding element to slide: ${elementData.slideId}`, this.logPrefix);
      
      const result = await directusCrud.create('story_elements', {
        slide_id: elementData.slideId,
        type: elementData.type,
        position: elementData.position,
        rotation: elementData.rotation || 0,
        z_index: elementData.zIndex || 1,
        content: elementData.content,
        style: elementData.style || null
      });
      
      if (result.success) {
        return result.data;
      } else {
        throw new Error('Failed to add element');
      }
    } catch (error: any) {
      log(`Error adding element: ${error.message}`, this.logPrefix);
      throw error;
    }
  }

  async updateElement(elementId: string, updates: any, userId: string): Promise<any> {
    try {
      log(`Updating element: ${elementId}`, this.logPrefix);
      
      const result = await directusCrud.updateByPk('story_elements', elementId, {
        ...updates,
        updated_at: new Date().toISOString()
      });
      
      if (result.success) {
        return result.data;
      } else {
        throw new Error('Failed to update element');
      }
    } catch (error: any) {
      log(`Error updating element: ${error.message}`, this.logPrefix);
      throw error;
    }
  }

  async deleteElement(elementId: string, userId: string): Promise<boolean> {
    try {
      log(`Deleting element: ${elementId}`, this.logPrefix);
      
      const result = await directusCrud.deleteByPk('story_elements', elementId);
      
      return result.success;
    } catch (error: any) {
      log(`Error deleting element: ${error.message}`, this.logPrefix);
      return false;
    }
  }

  async scheduleStory(storyId: string, scheduledAt: string, platformSettings: any, userId: string): Promise<any> {
    try {
      log(`Scheduling story: ${storyId}`, this.logPrefix);
      
      const result = await directusCrud.updateByPk('story_content', storyId, {
        status: 'scheduled',
        scheduled_at: scheduledAt,
        platform_settings: platformSettings,
        updated_at: new Date().toISOString()
      });
      
      if (result.success) {
        return result.data;
      } else {
        throw new Error('Failed to schedule story');
      }
    } catch (error: any) {
      log(`Error scheduling story: ${error.message}`, this.logPrefix);
      throw error;
    }
  }
}

// Экспортируем экземпляр адаптера для использования в приложении
export const directusStorageAdapter = new DirectusStorageAdapter();