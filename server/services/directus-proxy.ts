/**
 * Directus Proxy Service
 * Единственная точка доступа к Directus API с встроенной авторизацией
 * 
 * Все методы:
 * 1. Проверяют доступ пользователя к кампании
 * 2. Используют user token для запросов
 * 3. Бросают ошибку при отсутствии доступа
 */

import { directusCrud } from './directus-crud';

export class DirectusProxyService {
  
  /**
   * Получение кампании с проверкой доступа
   * @private
   */
  private async getUserCampaign(
    campaignId: string,
    userId: string,
    token: string
  ): Promise<any> {
    const campaigns = await directusCrud.list('user_campaigns', {
      authToken: token,
      userId,
      filter: {
        id: { _eq: campaignId },
        user_id: { _eq: userId }
      },
      limit: 1
    });

    return campaigns && campaigns.length > 0 ? campaigns[0] : null;
  }

  /**
   * Проверка доступа пользователя к кампании
   * @throws Error если доступ запрещен
   */
  async verifyUserCampaignAccess(
    campaignId: string,
    userId: string,
    token: string
  ): Promise<boolean> {
    try {
      const campaign = await this.getUserCampaign(campaignId, userId, token);
      return !!campaign;
    } catch (error) {
      console.error('Campaign access verification failed:', error);
      return false;
    }
  }

  /**
   * Получение источников постов (trends)
   * @param params - параметры запроса
   * @returns массив постов
   * @throws Error при отсутствии доступа
   */
  async getSourcePosts(params: {
    campaignId: string;
    userId: string;
    token: string;
    dateFrom?: string;
    limit?: number;
    sort?: string[];
  }) {
    const { campaignId, userId, token, dateFrom, limit = 50, sort = ['-date'] } = params;
    
    // Проверка доступа
    const hasAccess = await this.verifyUserCampaignAccess(campaignId, userId, token);
    if (!hasAccess) {
      throw new Error('Access denied to campaign');
    }

    // Формирование фильтра
    const filter: any = { campaign_id: { _eq: campaignId } };
    if (dateFrom) {
      filter.date = { _gte: dateFrom };
    }

    const posts = await directusCrud.list('source_posts', {
      authToken: token,
      userId,
      filter,
      limit,
      sort
    });

    return posts || [];
  }

  /**
   * Получение ключевых слов кампании
   * @param params - параметры запроса
   * @returns массив ключевых слов
   * @throws Error при отсутствии доступа
   */
  async getCampaignKeywords(params: {
    campaignId: string;
    userId: string;
    token: string;
  }) {
    const { campaignId, userId, token } = params;
    
    // Проверка доступа
    const hasAccess = await this.verifyUserCampaignAccess(campaignId, userId, token);
    if (!hasAccess) {
      throw new Error('Access denied to campaign');
    }

    const keywords = await directusCrud.list('campaign_keywords', {
      authToken: token,
      userId,
      filter: { campaign_id: { _eq: campaignId } }
    });

    return keywords || [];
  }

  /**
   * Получение источников контента кампании
   * @param params - параметры запроса
   * @returns массив источников
   * @throws Error при отсутствии доступа
   */
  async getCampaignSources(params: {
    campaignId: string;
    userId: string;
    token: string;
  }) {
    const { campaignId, userId, token } = params;
    
    const hasAccess = await this.verifyUserCampaignAccess(campaignId, userId, token);
    if (!hasAccess) {
      throw new Error('Access denied to campaign');
    }

    const sources = await directusCrud.list('campaign_content_sources', {
      authToken: token,
      userId,
      filter: { campaign_id: { _eq: campaignId } }
    });

    return sources || [];
  }

  /**
   * Получение информации о кампании
   * @param params - параметры запроса
   * @returns данные кампании
   * @throws Error при отсутствии доступа
   */
  async getCampaign(params: {
    campaignId: string;
    userId: string;
    token: string;
  }) {
    const { campaignId, userId, token } = params;
    
    const campaign = await this.getUserCampaign(campaignId, userId, token);
    if (!campaign) {
      throw new Error('Campaign not found or access denied');
    }

    return campaign;
  }

  /**
   * Получение всех кампаний пользователя
   * @param params - параметры запроса
   * @returns массив кампаний
   */
  async getUserCampaigns(params: {
    userId: string;
    token: string;
  }) {
    const { userId, token } = params;
    
    const campaigns = await directusCrud.list('user_campaigns', {
      authToken: token,
      userId,
      filter: {
        user_id: { _eq: userId }
      }
    });

    return campaigns || [];
  }

  /**
   * Получение информации о текущем пользователе
   * @param params - параметры запроса
   * @returns данные пользователя
   */
  async getCurrentUser(params: {
    token: string;
  }) {
    const { token } = params;
    
    const user = await directusCrud.custom('get', '/users/me', undefined, {
      authToken: token
    });
    return user || null;
  }

  /**
   * Обновление кампании
   * @param params - параметры запроса
   * @returns обновленная кампания
   */
  async updateCampaign(params: {
    campaignId: string;
    userId: string;
    token: string;
    data: any;
  }) {
    const { campaignId, userId, token, data } = params;
    
    // Проверяем доступ
    const campaign = await this.getUserCampaign(campaignId, userId, token);
    if (!campaign) {
      throw new Error('Campaign not found or access denied');
    }

    const updated = await directusCrud.update('user_campaigns', campaignId, data, {
      authToken: token,
      userId
    });

    return updated || null;
  }

  /**
   * Создание ключевого слова
   * @param params - параметры запроса
   * @returns созданное ключевое слово
   */
  async createKeyword(params: {
    campaignId: string;
    userId: string;
    token: string;
    data: any;
  }) {
    const { campaignId, userId, token, data } = params;
    
    // Проверяем доступ к кампании
    const campaign = await this.getUserCampaign(campaignId, userId, token);
    if (!campaign) {
      throw new Error('Campaign not found or access denied');
    }

    const created = await directusCrud.create('campaign_keywords', data, {
      authToken: token,
      userId
    });

    return created || null;
  }

  /**
   * Удаление ключевого слова
   * @param params - параметры запроса
   */
  async deleteKeyword(params: {
    keywordId: string;
    userId: string;
    token: string;
  }) {
    const { keywordId, userId, token } = params;
    
    // Получаем ключевое слово для проверки доступа
    const keyword = await directusCrud.getById('campaign_keywords', keywordId, {
      authToken: token,
      userId
    });
    
    if (!keyword) {
      throw new Error('Keyword not found');
    }

    // Проверяем доступ к кампании
    const campaign = await this.getUserCampaign(keyword.campaign_id, userId, token);
    if (!campaign) {
      throw new Error('Access denied');
    }

    await directusCrud.delete('campaign_keywords', keywordId, {
      authToken: token,
      userId
    });
  }

  /**
   * Удаление источника
   * @param params - параметры запроса
   */
  async deleteSource(params: {
    sourceId: string;
    userId: string;
    token: string;
  }) {
    const { sourceId, userId, token } = params;
    
    // Получаем источник для проверки доступа
    const source = await directusCrud.getById('campaign_content_sources', sourceId, {
      authToken: token,
      userId
    });
    
    if (!source) {
      throw new Error('Source not found');
    }

    // Проверяем доступ к кампании
    const campaign = await this.getUserCampaign(source.campaign_id, userId, token);
    if (!campaign) {
      throw new Error('Access denied');
    }

    await directusCrud.delete('campaign_content_sources', sourceId, {
      authToken: token,
      userId
    });
  }

  /**
   * Создание trend topic
   * @param params - параметры запроса
   */
  async createTrendTopic(params: {
    data: {
      title: string;
      campaign_id: string;
      source_id?: string;
      reactions?: number;
      comments?: number;
      views?: number;
      is_bookmarked?: boolean;
    };
    userId: string;
    token: string;
  }) {
    const { data, userId, token } = params;

    // Проверяем доступ к кампании
    const campaign = await this.getUserCampaign(data.campaign_id, userId, token);
    if (!campaign) {
      throw new Error('Access denied');
    }

    // source_id обязан принадлежать ТОЙ ЖЕ кампании. Без этой проверки тренд со
    // ссылкой на чужой источник становился мостом между арендаторами: дальше
    // analyze-comments(level=source) по своему тренду читал чужие тренды и
    // перезаписывал sentiment_analysis чужого источника служебным токеном
    // (находка ревью 2026-07-29). «Не найдено» и «чужой» отвечают одинаково,
    // чтобы ручка не работала оракулом существования чужих UUID.
    if (data.source_id) {
      const source = await directusCrud.getById<any>(
        'campaign_content_sources',
        String(data.source_id),
        { useAdminToken: true },
      );
      const sourceCampaignId = source?.campaign_id ?? source?.campaignId ?? null;
      if (!source || String(sourceCampaignId) !== String(data.campaign_id)) {
        throw new Error('Source not found in campaign');
      }
    }

    const created = await directusCrud.create('campaign_trend_topics', data, {
      authToken: token,
      userId
    });

    return created;
  }

  /**
   * Создание контент генерации
   * @param params - параметры запроса
   * @returns созданная запись
   */
  async createContentGeneration(params: {
    campaignId: string;
    userId: string;
    token: string;
    data: any;
  }) {
    const { campaignId, userId, token, data } = params;
    
    // Проверяем доступ к кампании
    const hasAccess = await this.verifyUserCampaignAccess(campaignId, userId, token);
    if (!hasAccess) {
      throw new Error('Access denied to campaign');
    }
    
    const result = await directusCrud.create('campaign_content', data, {
      useAdminToken: true,
      userId
    });
    
    return result;
  }
}

export const directusProxy = new DirectusProxyService();
