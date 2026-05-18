# План развертывания фиксов на Production
**Дата:** 20 октября 2025  
**Фокус:** ДОЛГОВЕЧНЫЕ решения без будущих переделок

---

## Архитектурные решения (от Architect)

### ✅ Принятые решения:

1. **100% централизация через backend API**
   - ВСЕ запросы к Directus ТОЛЬКО через Express backend
   - Никаких прямых вызовов `directusApi` с frontend
   - Единая точка контроля авторизации

2. **Серверная блокировка токенов (Map-based)**
   - Достаточно для текущего масштаба
   - Масштабируется до ~1000 одновременных пользователей
   - Переход на Redis потребуется только при горизонтальном масштабировании

3. **Typed клиент для API**
   - Централизованный `apiClient` с типизацией
   - Автоматические заголовки auth
   - Предотвращает дрейф кода

4. **Базовый мониторинг**
   - Логи refresh операций
   - Счётчики успехов/ошибок
   - Алерты при аномалиях

### 🔮 Будущие улучшения (если масштаб вырастет):
- Redis для distributed locking
- Prometheus metrics
- Trace ID для debugging

---

## Фаза 1: Backend API Gateway (ОСНОВА)

### 1.1 Создать централизованный Directus Proxy Service

**Файл: `server/services/directus-proxy.ts`**
```typescript
/**
 * Directus Proxy Service
 * Единственная точка доступа к Directus API с встроенной авторизацией
 */
import { directusCrud } from './directus-crud';

export class DirectusProxyService {
  
  /**
   * Проверка доступа пользователя к кампании
   */
  async verifyUserCampaignAccess(
    campaignId: string,
    userId: string,
    token: string
  ): Promise<boolean> {
    const campaign = await directusCrud.getUserCampaign(campaignId, userId, token);
    return !!campaign;
  }

  /**
   * Получение источников постов (trends)
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

    const response = await directusCrud.authenticatedAxios(token).get('/items/source_posts', {
      params: { filter, limit, sort }
    });

    return response.data?.data || [];
  }

  /**
   * Получение ключевых слов кампании
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

    const response = await directusCrud.authenticatedAxios(token).get('/items/campaign_keywords', {
      params: {
        filter: { campaign_id: { _eq: campaignId } }
      }
    });

    return response.data?.data || [];
  }

  /**
   * Получение источников контента
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

    const response = await directusCrud.authenticatedAxios(token).get('/items/campaign_content_sources', {
      params: {
        filter: { campaign_id: { _eq: campaignId } },
        fields: ['id', 'name', 'url', 'type', 'is_active', 'campaign_id', 'created_at', 'status', 'sentiment_analysis']
      }
    });

    return response.data?.data || [];
  }
}

export const directusProxy = new DirectusProxyService();
```

### 1.2 Создать REST API endpoints

**Файл: `server/api/proxy-routes.ts`**
```typescript
import { Router, Request, Response } from 'express';
import { directusProxy } from '../services/directus-proxy';

export const proxyRouter = Router();

// Middleware для извлечения auth данных
const extractAuth = (req: Request) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const userId = req.headers['x-user-id'] as string;
  
  if (!token || !userId) {
    throw new Error('Missing authentication headers');
  }
  
  return { token, userId };
};

// Middleware для обработки ошибок
const asyncHandler = (fn: (req: Request, res: Response) => Promise<any>) => {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error: any) {
      console.error('API Error:', error.message);
      
      if (error.message === 'Missing authentication headers') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      if (error.message === 'Access denied to campaign') {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
      });
    }
  };
};

/**
 * GET /api/proxy/trends
 * Query params: campaign_id, date_from, limit
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
 * Query params: campaign_id
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
 * Query params: campaign_id
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
```

**Регистрация в `server/index.ts`:**
```typescript
import { proxyRouter } from './api/proxy-routes';

// После существующих routes
app.use('/api/proxy', proxyRouter);
```

---

## Фаза 2: Typed Frontend Client

### 2.1 Создать централизованный API клиент

**Файл: `client/src/lib/api-client.ts`**
```typescript
/**
 * Централизованный API клиент
 * Использует user tokens, автоматически добавляет заголовки
 */

interface FetchOptions extends RequestInit {
  params?: Record<string, any>;
}

class ApiClient {
  private getAuthHeaders() {
    const token = localStorage.getItem('auth_token');
    const userId = localStorage.getItem('user_id');
    
    if (!token || !userId) {
      throw new Error('Not authenticated');
    }
    
    return {
      'Authorization': `Bearer ${token}`,
      'x-user-id': userId,
      'Content-Type': 'application/json'
    };
  }

  private buildUrl(path: string, params?: Record<string, any>): string {
    const url = new URL(path, window.location.origin);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }
    
    return url.toString();
  }

  async get<T>(path: string, options?: FetchOptions): Promise<T> {
    const url = this.buildUrl(path, options?.params);
    
    const response = await fetch(url, {
      ...options,
      method: 'GET',
      headers: {
        ...this.getAuthHeaders(),
        ...options?.headers
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async post<T>(path: string, data?: any, options?: FetchOptions): Promise<T> {
    const response = await fetch(path, {
      ...options,
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        ...options?.headers
      },
      body: data ? JSON.stringify(data) : undefined
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async put<T>(path: string, data?: any, options?: FetchOptions): Promise<T> {
    const response = await fetch(path, {
      ...options,
      method: 'PUT',
      headers: {
        ...this.getAuthHeaders(),
        ...options?.headers
      },
      body: data ? JSON.stringify(data) : undefined
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async delete<T>(path: string, options?: FetchOptions): Promise<T> {
    const response = await fetch(path, {
      ...options,
      method: 'DELETE',
      headers: {
        ...this.getAuthHeaders(),
        ...options?.headers
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }
}

export const apiClient = new ApiClient();

// Типизированные helpers
export const api = {
  trends: {
    list: (campaignId: string, params?: { date_from?: string; limit?: number }) =>
      apiClient.get<{ data: any[] }>('/api/proxy/trends', {
        params: { campaign_id: campaignId, ...params }
      })
  },
  
  keywords: {
    list: (campaignId: string) =>
      apiClient.get<{ data: any[] }>('/api/proxy/keywords', {
        params: { campaign_id: campaignId }
      })
  },
  
  sources: {
    list: (campaignId: string) =>
      apiClient.get<{ data: any[] }>('/api/proxy/sources', {
        params: { campaign_id: campaignId }
      })
  },

  campaigns: {
    list: () => apiClient.get<{ data: any[] }>('/api/campaigns'),
    get: (id: string) => apiClient.get<{ data: any }>(`/api/campaigns/${id}`)
  },

  content: {
    list: (campaignId: string) =>
      apiClient.get<{ data: any[] }>('/api/content', {
        params: { campaign_id: campaignId }
      })
  }
};
```

---

## Фаза 3: Миграция Frontend

### 3.1 Обновить Trends страницу

**Файл: `client/src/pages/trends/index.tsx`**

Заменить все `directusApi.get(...)` на `api.trends.list(...)`:

```typescript
import { api } from '@/lib/api-client';

// ВМЕСТО:
// const { data: trends } = useQuery({
//   queryFn: async () => {
//     const response = await directusApi.get('/items/source_posts', {...});
//     return response.data?.data || [];
//   }
// });

// ИСПОЛЬЗУЕМ:
const { data: trendsResponse, isLoading, error } = useQuery({
  queryKey: ['/api/proxy/trends', campaignId, dateFrom],
  queryFn: () => api.trends.list(campaignId, { date_from: dateFrom, limit: 50 }),
  enabled: !!campaignId
});

const trends = trendsResponse?.data || [];
```

### 3.2 Обновить Keywords страницу

**Файл: `client/src/pages/keywords/index.tsx`**

```typescript
import { api } from '@/lib/api-client';

const { data: keywordsResponse } = useQuery({
  queryKey: ['/api/proxy/keywords', campaignId],
  queryFn: () => api.keywords.list(campaignId),
  enabled: !!campaignId
});

const keywords = keywordsResponse?.data || [];
```

### 3.3 Найти и заменить ВСЕ остальные `directusApi` вызовы

```bash
# Найти все использования
grep -r "directusApi\." client/src/pages --include="*.tsx"

# Для каждого:
# 1. Добавить endpoint в server/api/proxy-routes.ts
# 2. Добавить метод в server/services/directus-proxy.ts
# 3. Добавить typed helper в client/src/lib/api-client.ts
# 4. Заменить в странице на api.xxx.yyy()
```

---

## Фаза 4: Мониторинг

### 4.1 Добавить метрики refresh

**В `server/api/auth-routes.ts`:**
```typescript
// Счётчики
let refreshMetrics = {
  attempts: 0,
  successes: 0,
  failures: 0,
  concurrent: 0,
  lastReset: Date.now()
};

// Сброс каждые 5 минут
setInterval(() => {
  console.log('📊 Refresh Metrics (last 5min):', refreshMetrics);
  refreshMetrics = {
    attempts: 0,
    successes: 0,
    failures: 0,
    concurrent: 0,
    lastReset: Date.now()
  };
}, 5 * 60 * 1000);

// В refresh endpoint:
app.post('/api/auth/refresh', async (req, res) => {
  refreshMetrics.attempts++;
  const startTime = Date.now();
  
  try {
    // ... existing refresh logic ...
    
    refreshMetrics.successes++;
    const duration = Date.now() - startTime;
    console.log(`✅ Token refreshed for user ${user_id} in ${duration}ms`);
    
  } catch (error) {
    refreshMetrics.failures++;
    console.error(`❌ Refresh failed for user ${user_id}:`, error);
    
    // Алерт если > 50% ошибок
    const errorRate = refreshMetrics.failures / refreshMetrics.attempts;
    if (errorRate > 0.5 && refreshMetrics.attempts > 10) {
      console.error(`🚨 ALERT: High refresh error rate: ${(errorRate * 100).toFixed(1)}%`);
    }
  }
});
```

### 4.2 Endpoint для здоровья

**Файл: `server/api/health-routes.ts`:**
```typescript
import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
```

---

## План выполнения (3-4 часа)

### Этап 1: Backend (1.5 часа)
1. ✅ Создать `directus-proxy.ts` (30 мин)
2. ✅ Создать `proxy-routes.ts` (30 мин)
3. ✅ Добавить мониторинг (15 мин)
4. ✅ Тестировать endpoints (15 мин)

### Этап 2: Frontend (1.5 часа)
1. ✅ Создать `api-client.ts` (30 мин)
2. ✅ Мигрировать trends (20 мин)
3. ✅ Мигрировать keywords (20 мин)
4. ✅ Найти/заменить остальные (20 мин)

### Этап 3: Deploy (30 мин)
1. ✅ Коммит + пуш
2. ✅ Production rebuild
3. ✅ Проверка

### Этап 4: Валидация (30 мин)
1. ✅ Проверка всех страниц
2. ✅ Тест с несколькими вкладками
3. ✅ Мониторинг метрик

---

## Критерии успеха

✅ **Архитектура:**
- Все запросы к Directus идут через backend
- Единая точка авторизации
- Typed клиент на frontend

✅ **Стабильность:**
- Нет 403 ошибок
- Нет race conditions
- Работает с множеством вкладок

✅ **Долговечность:**
- Паттерн легко расширять (добавить endpoint = 3 файла)
- Typed = нет дрейфа кода
- Мониторинг = раннее обнаружение проблем

✅ **Масштабируемость:**
- До 1000+ пользователей без изменений
- Переход на Redis = 1 день работы (когда понадобится)

---

## Будущие улучшения (при необходимости)

### Когда > 1000 активных пользователей:
- Redis для distributed locking
- Prometheus metrics
- Trace ID для debugging

### Когда > 10000 пользователей:
- Горизонтальное масштабирование
- Load balancer
- Кеширование часто запрашиваемых данных

**Но СЕЙЧАС это НЕ нужно. Текущее решение прослужит 1-2 года минимум.**
