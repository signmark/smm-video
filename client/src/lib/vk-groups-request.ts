import { authHeaders } from '@/lib/auth-headers';

/**
 * Загрузка списка сообществ VK по вручную вставленному токену.
 *
 * POST и токен ТЕЛОМ — токен VK нельзя отдавать в query (логи прокси, Referer).
 * Заголовок Authorization при этом ОБЯЗАТЕЛЕН: сессия приложения живёт в
 * localStorage, cookie к запросу не прикладывается, и без Bearer глобальный
 * гейт /api отвечает 401 ещё до обработчика (регрессия ревью 2026-07-29 —
 * ручная загрузка групп не работала вовсе).
 */
export function fetchVkGroupsByManualToken(manualToken: string): Promise<Response> {
  return fetch('/api/vk/groups', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ accessToken: manualToken }),
  });
}
