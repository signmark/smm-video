import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store';

/**
 * Единая точка входа для списка кампаний и карточки одной кампании.
 *
 * Зачем: на странице «Контент» за 14 мс уходили ТРИ параллельных
 * `GET /api/campaigns` (по 43 КБ) и ДВА `GET /api/campaigns/<id>`. React Query их
 * не схлопывал, потому что одни и те же данные лежали под разными ключами:
 * `['/api/campaigns']` (страница контента), `['/api/campaigns', userId]`
 * (CampaignSelector в топбаре) и `['/api/campaigns', selectedCampaignId]` (топбар).
 * Плюс отдельный ключ `['campaign-detail', id]` рядом с `['/api/campaigns', id]`.
 *
 * Отдельная грабля, из-за которой третий запрос был ещё и бессмысленным: у
 * топбара не было своего `queryFn`, а дефолтный шлёт голый GET по `queryKey[0]`.
 * То есть ключ `['/api/campaigns', selectedCampaignId]` тянул СПИСОК кампаний, а
 * компонент читал из ответа `autonomous_settings` — поле, которого в списочном
 * ответе на верхнем уровне нет. Тултип автономного режима поэтому всегда был пуст.
 *
 * Правило: ключи строим только этими функциями, `queryFn` живёт только здесь.
 * Ключ детали — префикс `['/api/campaigns', ...]`, чтобы существующие
 * `invalidateQueries({ queryKey: ['/api/campaigns'] })` продолжали его сбрасывать.
 */
export const campaignsListKey = (userId: string | null) => ['/api/campaigns', userId] as const;

export const campaignDetailKey = (campaignId: string | null | undefined) =>
  ['/api/campaigns', campaignId ?? '', 'detail'] as const;

function authHeaders(token: string | null, userId: string | null): Record<string, string> {
  return {
    Authorization: `Bearer ${token ?? ''}`,
    'x-user-id': userId ?? '',
  };
}

export interface CampaignsListResponse {
  success?: boolean;
  data?: any[];
}

/** Список кампаний пользователя. Один запрос на всё приложение. */
export function useCampaignsList() {
  const userId = useAuthStore((state) => state.userId);
  const token = useAuthStore((state) => state.token);
  const getAuthToken = useAuthStore((state) => state.getAuthToken);

  return useQuery<CampaignsListResponse>({
    queryKey: campaignsListKey(userId),
    queryFn: async () => {
      const token = getAuthToken();
      if (!token) throw new Error('Отсутствует токен авторизации');

      const response = await fetch('/api/campaigns', { headers: authHeaders(token, userId) });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Требуется авторизация. Пожалуйста, войдите снова.');
        }
        throw new Error(`Не удалось загрузить кампании (${response.status})`);
      }

      return response.json();
    },
    enabled: !!userId && !!token,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Полная карточка кампании. В отличие от списка отдаёт `content_style` — ради
 * него страница контента и ходит сюда отдельно.
 *
 * Возвращает сам объект кампании (уже развёрнутый из `{ success, data }`).
 */
export function useCampaignDetail(campaignId: string | null | undefined) {
  const userId = useAuthStore((state) => state.userId);
  const token = useAuthStore((state) => state.token);
  const getAuthToken = useAuthStore((state) => state.getAuthToken);

  return useQuery<any | null>({
    queryKey: campaignDetailKey(campaignId),
    queryFn: async () => {
      if (!campaignId) return null;

      const response = await fetch(`/api/campaigns/${campaignId}`, {
        headers: authHeaders(getAuthToken(), userId),
      });
      if (!response.ok) {
        throw new Error(`Не удалось загрузить кампанию (${response.status})`);
      }

      const payload = await response.json();
      return payload?.data ?? null;
    },
    enabled: !!campaignId && !!token,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}
