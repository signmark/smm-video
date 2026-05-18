import { useState } from 'react';
import { AlertTriangle, X, CreditCard } from 'lucide-react';
import { Link } from 'wouter';
import { usePlan } from '@/hooks/use-plan';
import { Button } from '@/components/ui/button';

export function SubscriptionExpiredBanner() {
  const { isExpired, expireDate, plan } = usePlan();
  const [dismissed, setDismissed] = useState(false);

  if (!expireDate) return null;

  const now = new Date();
  const expire = new Date(expireDate);
  const daysLeft = Math.ceil((expire.getTime() - now.getTime()) / (1000 * 3600 * 24));

  // Если истёк — показываем всегда (без возможности закрыть)
  // Если ещё не истёк но осталось ≤ 7 дней — предупреждение (можно закрыть)
  // Больше 7 дней — ничего не показываем
  if (!isExpired && daysLeft > 7) return null;
  if (!isExpired && dismissed) return null;

  const expireDateFormatted = expire.toLocaleDateString('ru-RU');

  if (isExpired) {
    return (
      <div className="bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-800 px-4 py-3">
        <div className="flex items-center gap-3 max-w-6xl mx-auto">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-red-800 dark:text-red-300">
              Пробный период закончился {expireDateFormatted}.
            </span>
            <span className="text-sm text-red-700 dark:text-red-400 ml-1">
              Выберите тариф, чтобы продолжить работу.
            </span>
          </div>
          <Link href="/pricing">
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white shrink-0"
              data-testid="button-subscribe-expired"
            >
              <CreditCard className="w-3.5 h-3.5 mr-1.5" />
              Выбрать тариф
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Предупреждение (≤ 7 дней до конца)
  return (
    <div className="bg-yellow-50 dark:bg-yellow-950/40 border-b border-yellow-200 dark:border-yellow-800 px-4 py-3">
      <div className="flex items-center gap-3 max-w-6xl mx-auto">
        <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
            Пробный период истекает через {daysLeft} {daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'} ({expireDateFormatted}).
          </span>
          <span className="text-sm text-yellow-700 dark:text-yellow-400 ml-1">
            Выберите тариф, чтобы не потерять доступ.
          </span>
        </div>
        <Link href="/pricing">
          <Button
            size="sm"
            variant="outline"
            className="border-yellow-400 text-yellow-800 hover:bg-yellow-100 dark:border-yellow-600 dark:text-yellow-300 shrink-0"
            data-testid="button-subscribe-warning"
          >
            <CreditCard className="w-3.5 h-3.5 mr-1.5" />
            Выбрать тариф
          </Button>
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="text-yellow-600 hover:text-yellow-800 dark:text-yellow-400 shrink-0"
          data-testid="button-dismiss-banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
