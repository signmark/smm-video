/**
 * Канонический источник профиля пользователя (task #84).
 *
 * Профиль `/api/user/profile` раньше читали ПЯТЬ независимых наблюдателей под
 * одним ключом, но с разной политикой свежести. Самый агрессивный — usePlan с
 * `staleTime: 0` + `refetchOnMount: true` (AI-64) — объявлял общий кэш вечно
 * протухшим, и на холодной странице профиль ехал дважды: первый fetch от
 * Topbar/Content, затем refetch от usePlan. Гонка не зависела от порядка монтажа.
 *
 * Здесь один ключ и одна политика для всех: `staleTime` 5 минут, без refetch по
 * монтажу, но всегда refetch при возврате фокуса окна. Внешнее изменение тарифа
 * (Telegram/письмо) подхватывается именно focus-обновлением на ЛЮБОМ маршруте —
 * как того требовал AI-64, но без превращения кэша в «всегда устаревший».
 *
 * Ключ несёт дискриминатор userId; смена аккаунта/сессии и так чистит кэш
 * (queryClient.clear в use-auth), а смена userId даёт новый ключ.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store';

export interface UserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_smm_admin: boolean;
  plan?: string;
  expire_date?: string | null;
}

export function profileQueryKey(userId: string | null | undefined): readonly [string, string] {
  return ['/api/user/profile', userId ?? 'me'] as const;
}

/** Свежесть профиля: НЕ на монтаже, но всегда по фокусу окна. */
export const PROFILE_STALE_TIME = 5 * 60 * 1000;

/**
 * Единый запрос профиля для всех наблюдателей. queryFn НЕ задаём — дефолтный
 * читает `queryKey[0]` = `/api/user/profile` (тот же fetch, что и раньше).
 */
export function useUserProfile() {
  const userId = useAuthStore((state) => state.userId);

  return useQuery<UserProfile>({
    queryKey: profileQueryKey(userId),
    enabled: !!userId,
    staleTime: PROFILE_STALE_TIME,
    refetchOnMount: false,
    // 'always' форсит refetch по фокусу окна даже при свежих данных — внешнее
    // одобрение тарифа (Telegram/письмо) видно сразу на ЛЮБОМ маршруте, без
    // превращения кэша в «всегда устаревший» (то, что ломало dedup раньше).
    refetchOnWindowFocus: 'always',
    retry: 1,
  });
}
