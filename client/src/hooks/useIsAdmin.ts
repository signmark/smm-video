import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store';

export function useIsAdmin() {
  const token = useAuthStore((state) => state.token);

  return useQuery({
    queryKey: ['/api/users/is-admin', token],
    queryFn: async () => {
      if (!token) return { isAdmin: false };
      
      const response = await fetch('/api/users/is-admin', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) return { isAdmin: false };
      return response.json();
    },
    enabled: !!token,
    staleTime: 0, // Никогда не использовать кеш
    refetchOnMount: 'always', // Всегда перезапрашивать при монтировании
    refetchOnWindowFocus: true, // Перезапрашивать при фокусе окна
  });
}