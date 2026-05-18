/**
 * Централизованный API клиент
 * 
 * Использует user tokens, автоматически добавляет заголовки авторизации
 * Все запросы идут через backend API, НЕ напрямую к Directus
 */
import { redirectToLogin } from "@/lib/public-routes";

interface FetchOptions extends RequestInit {
  params?: Record<string, any>;
}

class ApiClient {
  /**
   * Получение auth заголовков из localStorage
   */
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

  /**
   * Построение URL с query параметрами
   */
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

  /**
   * Обработка ответа с проверкой авторизации
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 401) {
      // Очищаем auth данные и редиректим на логин (только с защищённых страниц)
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user_id');
      localStorage.removeItem('user_email');
      redirectToLogin();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * GET запрос
   */
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

    return this.handleResponse<T>(response);
  }

  /**
   * POST запрос
   */
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

    return this.handleResponse<T>(response);
  }

  /**
   * PUT запрос
   */
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

    return this.handleResponse<T>(response);
  }

  /**
   * PATCH запрос
   */
  async patch<T>(path: string, data?: any, options?: FetchOptions): Promise<T> {
    const response = await fetch(path, {
      ...options,
      method: 'PATCH',
      headers: {
        ...this.getAuthHeaders(),
        ...options?.headers
      },
      body: data ? JSON.stringify(data) : undefined
    });

    return this.handleResponse<T>(response);
  }

  /**
   * DELETE запрос
   */
  async delete<T>(path: string, options?: FetchOptions): Promise<T> {
    const response = await fetch(path, {
      ...options,
      method: 'DELETE',
      headers: {
        ...this.getAuthHeaders(),
        ...options?.headers
      }
    });

    return this.handleResponse<T>(response);
  }
}

export const apiClient = new ApiClient();

/**
 * Typed API helpers
 * Используй эти методы вместо прямых fetch или directusApi вызовов
 */
export const api = {
  /**
   * User endpoints
   */
  user: {
    me: () => apiClient.get<{ data: any }>('/api/proxy/me')
  },

  /**
   * Trends (source_posts) endpoints
   */
  trends: {
    list: (campaignId: string, params?: { date_from?: string; limit?: number }) =>
      apiClient.get<{ data: any[] }>('/api/proxy/trends', {
        params: { campaign_id: campaignId, ...params }
      }),
    createTopic: (data: any) => apiClient.post<{ data: any }>('/api/proxy/trend-topics', data)
  },
  
  /**
   * Keywords endpoints
   */
  keywords: {
    list: (campaignId: string) =>
      apiClient.get<{ data: any[] }>('/api/proxy/keywords', {
        params: { campaign_id: campaignId }
      }),
    create: (data: any) => apiClient.post<{ data: any }>('/api/proxy/keywords', data),
    delete: (id: string) => apiClient.delete<{ success: boolean }>(`/api/proxy/keywords/${id}`)
  },
  
  /**
   * Sources (campaign_content_sources) endpoints
   */
  sources: {
    list: (campaignId: string) =>
      apiClient.get<{ data: any[] }>('/api/proxy/sources', {
        params: { campaign_id: campaignId }
      }),
    delete: (id: string) => apiClient.delete<{ success: boolean }>(`/api/proxy/sources/${id}`)
  },

  /**
   * Campaigns endpoints
   */
  campaigns: {
    list: () => apiClient.get<{ data: any[] }>('/api/campaigns'),
    listForUser: () => apiClient.get<{ data: any[] }>('/api/proxy/campaigns'),
    get: (id: string) => apiClient.get<{ data: any }>(`/api/campaigns/${id}`),
    update: (id: string, data: any) => apiClient.patch<{ data: any }>(`/api/campaigns/${id}`, data)
  },

  /**
   * Content endpoints
   */
  content: {
    list: (campaignId: string) =>
      apiClient.get<{ data: any[] }>('/api/content', {
        params: { campaign_id: campaignId }
      })
  },

  /**
   * Content Generations endpoints
   */
  contentGenerations: {
    create: (data: any) => apiClient.post<{ data: any }>('/api/proxy/content-generations', data)
  }
};
