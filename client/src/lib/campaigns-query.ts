/**
 * Общий query-ключ и опции для списка кампаний пользователя.
 *
 * Зачем вынесено: keywords, campaigns и dashboard независимо дёргают один и тот же
 * эндпоинт `/api/campaigns`. До этого хелпера каждый consumer строил свой
 * queryKey и свои опции, из-за чего:
 *   - keywords использовал `['/api/campaigns']` без userId и каждый раз ловил
 *     полную смену данных при переключении аккаунта;
 *   - campaigns держал `refetchInterval: 15000`, пере-фетча даже когда ничего
 *     не изменилось;
 *   - dashboard имел другой набор опций и не делил кэш с двумя предыдущими.
 *
 * После хелпера все три consumer'а должны использовать один и тот же exact key
 * `['/api/campaigns', userId]`, одинаковые `staleTime` и `enabled`. Это
 * условие проверяется регрессионным тестом в `__tests__/campaigns-query.test.ts`.
 */
import type { QueryKey, UseQueryOptions } from '@tanstack/react-query';

const CAMPAIGNS_KEY = '/api/campaigns' as const;

/**
 * Возвращает единый exact queryKey для списка кампаний.
 * Массив заморожен, чтобы случайно не сделать мутацию в одном из consumers.
 */
export function campaignsQueryKey(userId: string | null | undefined): QueryKey {
  if (!userId) {
    // Один и тот же «нет пользователя» ключ у всех, чтобы при анонимном mount
    // не плодить разные ключи и не получить рассинхрон.
    return Object.freeze([CAMPAIGNS_KEY]) as unknown as QueryKey;
  }
  return Object.freeze([CAMPAIGNS_KEY, userId]) as unknown as QueryKey;
}

/**
 * Единые опции для запроса списка кампаний. Используются всеми тремя
 * consumers (keywords, campaigns, dashboard). Полить не надо — после правки
 * данных инвалидация делается явно через `queryClient.invalidateQueries`
 * с тем же user-scoped ключом.
 */
export function campaignsListQueryOptions<TData>(params: {
  userId: string | null | undefined;
  queryFn: () => Promise<TData>;
}): UseQueryOptions<TData, Error, TData, QueryKey> {
  const { userId, queryFn } = params;
  return {
    queryKey: campaignsQueryKey(userId),
    queryFn,
    enabled: Boolean(userId),
    staleTime: 60_000,
    // polling сознательно не задан — явная инвалидация после мутаций.
  };
}

/**
 * Ключ инвалидации, который совпадает с тем, что возвращает `campaignsQueryKey(userId)`.
 * Удобно использовать в мутациях/обработчиках, чтобы не повторять литералы.
 */
export function campaignsInvalidationKey(userId: string | null | undefined): QueryKey {
  return campaignsQueryKey(userId);
}