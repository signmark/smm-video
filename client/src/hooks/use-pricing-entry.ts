import { useEffect } from 'react';
import { useUserProfile } from './use-user-profile';
import { useAuthStore } from '@/lib/store';

/**
 * Граница входа на тарифную панель (pricing): перечитывает каноничный профиль,
 * чтобы внешнее одобрение тарифа (Telegram/письмо) отразилось сразу.
 *
 * Выносим в хук, чтобы «вход на pricing → один canonical вызов» можно было
 * проверить исполнением (renderHook), а не только чтением исходника.
 */
export function usePricingEntryProfileRefresh() {
  const { refetch } = useUserProfile();
  const userId = useAuthStore((state) => state.userId);
  const token = useAuthStore((state) => state.token);
  const authenticated = !!(token && userId);

  useEffect(() => {
    if (authenticated) {
      refetch();
    }
  }, [authenticated, refetch]);
}
