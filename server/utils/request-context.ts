import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Сквозной контекст запроса (AI-65, этап 2 из docs/LOGGING-PLAN.md).
 *
 * Задача: по одному идентификатору собрать все строки лога, порождённые одним
 * запросом. Без этого разбор инцидента упирается в то, что строки от разных
 * запросов перемешаны, а связать их нечем — именно поэтому AI-39 и AI-64
 * оказались невидимы в логах.
 *
 * AsyncLocalStorage, а не параметр в каждой функции: логирует весь код, включая
 * сервисы на три уровня ниже роутера, и протаскивать туда reqId руками пришлось
 * бы через сотни сигнатур. ALS переживает await и не требует изменений в местах
 * вызова.
 *
 * Хранится только то, что разрешено allowlist'ом задачи: идентификаторы, не
 * содержимое. Ни тела, ни query, ни токенов здесь быть не должно.
 */
export interface RequestContext {
  reqId: string;
  userId?: string;
  campaignId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Заголовок, которым внешний балансировщик может задать свой идентификатор. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Короткий идентификатор: 12 hex-символов.
 *
 * Полный UUID в каждой строке — это 36 символов шума на строку при том, что
 * различать нужно запросы в пределах одного разбора, а не глобально и навсегда.
 */
export function generateRequestId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

/**
 * Чужой идентификатор принимаем, но не доверяем ему вслепую: он попадёт в
 * логи, поэтому ограничиваем алфавит и длину. Мусор молча заменяем своим —
 * падать из-за заголовка нельзя.
 */
export function sanitizeRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Идентификатор для строки лога. Вне запроса возвращает undefined. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.reqId;
}

/**
 * Доопределяет контекст, когда данные стали известны: userId после проверки
 * сессии, campaignId после authorizeCampaignAccess. Вне запроса — молча ничего.
 */
export function enrichRequestContext(patch: Partial<Omit<RequestContext, 'reqId'>>): void {
  const store = storage.getStore();
  if (!store) return;
  if (patch.userId !== undefined) store.userId = patch.userId;
  if (patch.campaignId !== undefined) store.campaignId = patch.campaignId;
}

/**
 * Шаблон маршрута вместо подставленных идентификаторов.
 *
 * `/api/analytics/e6063049-…` и `/api/analytics/f0fe859b-…` — это один маршрут.
 * Если писать их как есть, любой поиск по логам и любая метрика получают
 * бесконечную кардинальность: столько же значений, сколько кампаний.
 */
export function routePattern(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d{2,}/g, '/:id');
}
