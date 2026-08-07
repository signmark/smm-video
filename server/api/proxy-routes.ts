/**
 * Proxy Routes - Backend API Gateway для Directus
 * 
 * Все запросы к Directus проходят через эти endpoints:
 * - Автоматическая проверка авторизации
 * - Проверка доступа к кампаниям
 * - Единая обработка ошибок
 * 
 * Updated: 2025-10-20 - Fixed token handling to use headers directly
 */

import { Router, Request, Response } from 'express';
import { directusProxy } from '../services/directus-proxy';
import { authenticateUser } from '../middleware/user-auth';
import { log } from '../utils/logger';

export const proxyRouter = Router();

// Своя авторизация, а не по счастливому порядку монтирования: до этой строки
// весь /api гейтился тем, что facebookGroupsRouter подключён раньше.
proxyRouter.use(authenticateUser);

/**
 * Извлечение auth данных запроса.
 *
 * `userId` берётся ТОЛЬКО из проверенной сессии. Раньше он читался из заголовка
 * `x-user-id`, который никто не сверял с токеном: подставив чужой id, можно было
 * читать и править чужие кампании, источники и тренды (находка ревью 2026-07-28).
 *
 * @throws Error если сессия или токен отсутствуют
 */
const extractAuth = (req: Request) => {
  const user = (req as any).user;
  const token = user?.token || req.headers.authorization?.replace('Bearer ', '');
  const userId = user?.id;

  if (!token || !userId) {
    throw new Error('Missing authentication headers');
  }

  return { token, userId: String(userId) };
};

/**
 * Универсальный обработчик ошибок для async routes
 */
const asyncHandler = (fn: (req: Request, res: Response) => Promise<any>) => {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error: any) {
      log.error('API Error:', error.message);
      
      if (error.message === 'Missing authentication headers') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      if (error.message === 'Access denied to campaign' || error.message.includes('access denied')) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: 'Resource not found' });
      }
      
      res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };
};

/**
 * GET /api/proxy/trends
 * 
 * Получение трендов (source_posts) для кампании
 * 
 * Query params:
 * - campaign_id (required): ID кампании
 * - date_from (optional): Фильтр по дате (ISO string)
 * - limit (optional): Лимит записей (default: 50)
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.get('/trends', asyncHandler(async (req, res) => {
  const { token, userId } = extractAuth(req);
  const { campaign_id, date_from, limit } = req.query;
  
  if (!campaign_id) {
    return res.status(400).json({ error: 'campaign_id is required' });
  }

  const trends = await directusProxy.getSourcePosts({
    campaignId: campaign_id as string,
    userId,
    token,
    dateFrom: date_from as string | undefined,
    limit: limit ? Number(limit) : undefined
  });

  res.json({ data: trends });
}));

/**
 * GET /api/proxy/keywords
 * 
 * Получение ключевых слов кампании
 * 
 * Query params:
 * - campaign_id (required): ID кампании
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.get('/keywords', asyncHandler(async (req, res) => {
  const { token, userId } = extractAuth(req);
  const { campaign_id } = req.query;
  
  if (!campaign_id) {
    return res.status(400).json({ error: 'campaign_id is required' });
  }

  const keywords = await directusProxy.getCampaignKeywords({
    campaignId: campaign_id as string,
    userId,
    token
  });

  res.json({ data: keywords });
}));

/**
 * GET /api/proxy/sources
 * 
 * Получение источников контента кампании
 * 
 * Query params:
 * - campaign_id (required): ID кампании
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.get('/sources', asyncHandler(async (req, res) => {
  const { token, userId } = extractAuth(req);
  const { campaign_id } = req.query;
  
  if (!campaign_id) {
    return res.status(400).json({ error: 'campaign_id is required' });
  }

  const sources = await directusProxy.getCampaignSources({
    campaignId: campaign_id as string,
    userId,
    token
  });

  res.json({ data: sources });
}));

/**
 * GET /api/proxy/campaign/:id
 * 
 * Получение информации о кампании
 * 
 * Params:
 * - id: ID кампании
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.get('/campaign/:id', asyncHandler(async (req, res) => {
  const { token, userId } = extractAuth(req);
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: 'campaign id is required' });
  }

  const campaign = await directusProxy.getCampaign({
    campaignId: id,
    userId,
    token
  });

  res.json({ data: campaign });
}));

/**
 * GET /api/proxy/campaigns
 * 
 * Получение всех кампаний пользователя
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.get('/campaigns', asyncHandler(async (req, res) => {
  const { token, userId } = extractAuth(req);

  const campaigns = await directusProxy.getUserCampaigns({
    userId,
    token
  });

  res.json({ data: campaigns });
}));

/**
 * GET /api/proxy/me
 * 
 * Получение информации о текущем пользователе
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.get('/me', asyncHandler(async (req, res) => {
  const { token } = extractAuth(req);

  const user = await directusProxy.getCurrentUser({ token });

  res.json({ data: user });
}));

/**
 * PATCH /api/proxy/campaign/:id
 * 
 * Обновление кампании
 * 
 * Params:
 * - id: ID кампании
 * 
 * Body: данные для обновления
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.patch('/campaign/:id', asyncHandler(async (req, res) => {
  const { token, userId } = extractAuth(req);
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: 'campaign id is required' });
  }

  const campaign = await directusProxy.updateCampaign({
    campaignId: id,
    userId,
    token,
    data: req.body
  });

  res.json({ data: campaign });
}));

/**
 * POST /api/proxy/keywords
 * 
 * Создание ключевого слова
 * 
 * Body:
 * - campaign_id: ID кампании
 * - keyword: текст ключевого слова
 * - trend_score: оценка тренда (опционально)
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.post('/keywords', asyncHandler(async (req, res) => {
  const { token, userId } = extractAuth(req);
  const { campaign_id } = req.body;
  
  if (!campaign_id) {
    return res.status(400).json({ error: 'campaign_id is required' });
  }

  const keyword = await directusProxy.createKeyword({
    campaignId: campaign_id,
    userId,
    token,
    data: req.body
  });

  res.json({ data: keyword });
}));

/**
 * DELETE /api/proxy/keywords/:id
 * 
 * Удаление ключевого слова
 * 
 * Params:
 * - id: ID ключевого слова
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.delete('/keywords/:id', asyncHandler(async (req, res) => {
  const { token, userId } = extractAuth(req);
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: 'keyword id is required' });
  }

  await directusProxy.deleteKeyword({
    keywordId: id,
    userId,
    token
  });

  res.json({ success: true });
}));

/**
 * DELETE /api/proxy/sources/:id
 * 
 * Удаление источника
 * 
 * Params:
 * - id: ID источника
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.delete('/sources/:id', asyncHandler(async (req, res) => {
  const { token, userId } = extractAuth(req);
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: 'source id is required' });
  }

  await directusProxy.deleteSource({
    sourceId: id,
    userId,
    token
  });

  res.json({ success: true });
}));

/**
 * POST /api/proxy/trend-topics
 * 
 * Создание trend topic
 * 
 * Body:
 * - title: string
 * - campaign_id: string
 * - source_id?: string
 * - reactions?: number
 * - comments?: number
 * - views?: number
 * - is_bookmarked?: boolean
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.post('/trend-topics', asyncHandler(async (req, res) => {
  const { token, userId } = extractAuth(req);
  const data = req.body;

  const result = await directusProxy.createTrendTopic({
    data,
    userId,
    token
  });

  res.json({ data: result });
}));

/**
 * POST /api/proxy/content-generations
 * 
 * Создание контент генерации
 * 
 * Body:
 * - campaign_id (required): ID кампании
 * - другие поля контент генерации
 * 
 * Headers:
 * - Authorization: Bearer {token}
 * - x-user-id: {userId}
 */
proxyRouter.post('/content-generations', asyncHandler(async (req, res) => {
  const { token, userId } = extractAuth(req);
  const data = req.body;
  const campaignId = data.campaign_id;

  if (!campaignId) {
    return res.status(400).json({ error: 'campaign_id is required' });
  }

  const created = await directusProxy.createContentGeneration({
    campaignId,
    userId,
    token,
    data
  });

  res.json({ data: created });
}));
