import { ReactNode, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { Lock, AlertTriangle } from 'lucide-react';

interface SubscriptionGuardProps {
  children: ReactNode;
  feature: string;
  fallback?: ReactNode;
}

interface SubscriptionStatus {
  isExpired: boolean;
  daysLeft: number;
  expireDate?: string;
}

export function SubscriptionGuard({ children, feature, fallback }: SubscriptionGuardProps) {
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);

  useEffect(() => {
    const checkSubscription = async () => {
      if (!token || !userId) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          setLoading(false);
          return;
        }

        const data = await response.json();
        const user = data.user;

        // Администраторы имеют безлимитный доступ
        if (user?.is_smm_admin) {
          setSubscriptionStatus({ isExpired: false, daysLeft: -1 });
          setLoading(false);
          return;
        }

        if (!user?.expire_date) {
          // Нет даты окончания = безлимитная подписка
          setSubscriptionStatus({ isExpired: false, daysLeft: -1 });
          setLoading(false);
          return;
        }

        const now = new Date();
        const expireDate = new Date(user.expire_date);
        const timeDiff = expireDate.getTime() - now.getTime();
        const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));

        setSubscriptionStatus({
          isExpired: daysLeft <= 0,
          daysLeft: Math.max(0, daysLeft),
          expireDate: expireDate.toLocaleDateString('ru-RU')
        });
      } catch (error) {
        console.error('Ошибка при проверке статуса подписки:', error);
      }
      
      setLoading(false);
    };

    checkSubscription();
  }, [token, userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Если подписка истекла, показываем блокировку
  if (subscriptionStatus?.isExpired) {
    const defaultFallback = (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <div className="flex justify-center mb-4">
          <Lock className="h-12 w-12 text-red-500" />
        </div>
        <h3 className="text-lg font-semibold text-red-800 mb-2">
          Функция недоступна
        </h3>
        <p className="text-red-700 mb-2">
          Ваша подписка истекла {subscriptionStatus.expireDate}.
        </p>
        <p className="text-red-600 text-sm">
          Обратитесь к администратору для продления подписки и восстановления доступа к функции "{feature}".
        </p>
      </div>
    );

    return fallback || defaultFallback;
  }

  // Если подписка активна или безлимитная, показываем контент
  return <>{children}</>;
}

/**
 * Hook для проверки статуса подписки
 */
export function useSubscriptionStatus() {
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);

  useEffect(() => {
    const checkSubscription = async () => {
      if (!token || !userId) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          setLoading(false);
          return;
        }

        const data = await response.json();
        const user = data.user;

        // Администраторы имеют безлимитный доступ
        if (user?.is_smm_admin) {
          setSubscriptionStatus({ isExpired: false, daysLeft: -1 });
          setLoading(false);
          return;
        }

        if (!user?.expire_date) {
          setSubscriptionStatus({ isExpired: false, daysLeft: -1 });
          setLoading(false);
          return;
        }

        const now = new Date();
        const expireDate = new Date(user.expire_date);
        const timeDiff = expireDate.getTime() - now.getTime();
        const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));

        setSubscriptionStatus({
          isExpired: daysLeft <= 0,
          daysLeft: Math.max(0, daysLeft),
          expireDate: expireDate.toLocaleDateString('ru-RU')
        });
      } catch (error) {
        console.error('Ошибка при проверке статуса подписки:', error);
      }
      
      setLoading(false);
    };

    checkSubscription();
  }, [token, userId]);

  return { subscriptionStatus, loading };
}