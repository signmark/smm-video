import { useEffect, useState } from 'react';
import { useLocation, Link } from 'wouter';
import { CheckCircle, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { queryClient } from '@/lib/queryClient';

export default function PaymentSuccessPage() {
  const [, navigate] = useLocation();
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState<'checking' | 'ok' | 'pending'>('checking');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const planParam = params.get('plan')
      || localStorage.getItem('pending_payment_plan')
      || '';
    const paymentId = params.get('paymentId')
      || localStorage.getItem('pending_payment_id')
      || '';
    setPlan(planParam);

    // Ключи из localStorage НЕ чистим здесь: раньше они стирались до исхода
    // поллинга, и перезагрузка страницы посреди проверки оставляла пользователя
    // без paymentId — повторить активацию было уже нечем (находка ревью
    // 2026-07-28). Чистим только когда тариф действительно активирован.
    const clearPendingPayment = () => {
      localStorage.removeItem('pending_payment_id');
      localStorage.removeItem('pending_payment_plan');
    };

    const token = localStorage.getItem('auth_token');

    if (!paymentId) {
      clearPendingPayment();
      setStatus('ok');
      return;
    }

    if (!token) {
      setStatus('ok');
      return;
    }

    let attempts = 0;
    const maxAttempts = 12;

    const tryActivate = async (pId: string, tok: string) => {
      try {
        const res = await fetch(`/api/payments/${pId}/activate`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tok}` },
        });
        if (res.ok) {
          // Инвалидируем кэш профиля чтобы фронт подхватил новый тариф
          queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
          queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
          clearPendingPayment();
          setStatus('ok');
          return true;
        }
        // 409 «идёт обработка» — не отказ: активация выполняется параллельно
        // (например, по вебхуку), надо просто подождать и повторить.
      } catch (_) {}
      return false;
    };

    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`/api/payments/${paymentId}/status`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'succeeded' || data.paid) {
            const activated = await tryActivate(paymentId, token);
            if (activated) {
              clearInterval(interval);
              return;
            }
            // Оплата прошла, но активация ещё не подтверждена. Раньше здесь
            // показывался успех — пользователь видел «Тариф активирован» без
            // тарифа. Продолжаем попытки до maxAttempts, потом честное «ожидает».
          }
        }
      } catch (_) {}

      if (attempts >= maxAttempts) {
        setStatus('pending');
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-gray-950 dark:to-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        {status === 'checking' ? (
          <div className="space-y-4">
            <Loader2 className="w-16 h-16 text-blue-600 animate-spin mx-auto" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Проверяем оплату…</h1>
            <p className="text-gray-500 dark:text-gray-400">Это займёт несколько секунд</p>
          </div>
        ) : status === 'ok' ? (
          <div className="space-y-6">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                Оплата прошла!
              </h1>
              {plan && (
                <p className="text-lg text-gray-600 dark:text-gray-300">
                  Тариф <strong>«{plan}»</strong> активирован на 30 дней.
                </p>
              )}
            </div>
            <Link href="/dashboard">
              <Button className="bg-blue-600 hover:bg-blue-700 px-8" data-testid="button-go-dashboard">
                Перейти в приложение <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="w-20 h-20 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center mx-auto">
              <Loader2 className="w-10 h-10 text-yellow-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                Платёж обрабатывается
              </h1>
              <p className="text-gray-600 dark:text-gray-300">
                Подписка активируется автоматически в течение нескольких минут.
                Если этого не произошло — напишите нам.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <Link href="/dashboard">
                <Button className="w-full bg-blue-600 hover:bg-blue-700" data-testid="button-go-dashboard-pending">
                  Перейти в приложение
                </Button>
              </Link>
              <a href="https://t.me/omemo_support" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="w-full" data-testid="button-contact-support">
                  Написать в поддержку
                </Button>
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
