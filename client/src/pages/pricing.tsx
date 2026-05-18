import { useState, useEffect, useRef } from 'react';
import { Check, X, Zap, BarChart3, Globe2, Bot, ArrowRight, Star, Shield, Clock, CreditCard, Send, Loader2, CheckCircle, Tag, XCircle, Crown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { SiInstagram, SiYoutube, SiTelegram, SiVk, SiFacebook, SiThreads } from 'react-icons/si';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Link, useLocation } from 'wouter';
import { usePageMeta } from '@/hooks/use-page-meta';

// Иерархия тарифов: чем выше число — тем старше тариф
const PLAN_LEVEL: Record<string, number> = {
  trial: 0,
  basic: 1,
  pro: 2,
  enterprise: 3,
};

const PLANS = [
  {
    key: 'pro',
    name: 'Профессиональный',
    price: 670,
    originalPrice: 1990,
    period: 'мес',
    description: 'Полный доступ ко всем функциям платформы',
    popular: true,
    beta: true,
    disabled: false,
    cta: 'Выбрать тариф',
    ctaExternal: null,
    features: [
      { text: 'Неограниченные кампании', ok: true },
      { text: 'Неограниченные публикации', ok: true },
      { text: 'Все 6 платформ: Telegram, VK, Instagram, Facebook, YouTube, TikTok', ok: true },
      { text: 'ИИ-генерация текстов (Gemini, Claude, DeepSeek)', ok: true },
      { text: 'ИИ-генерация изображений (без ограничений)', ok: true },
      { text: 'Публикация Reels / Stories / Shorts', ok: true },
      { text: 'Планировщик публикаций', ok: true },
      { text: 'Аналитика и отчёты', ok: true },
      { text: 'Telegram-бот управления', ok: true },
      { text: 'Поддержка в чате', ok: true },
    ],
  },
  {
    key: 'basic',
    name: 'Базовый',
    price: 390,
    originalPrice: 990,
    period: 'мес',
    description: 'Для небольших проектов и старта',
    popular: false,
    beta: false,
    disabled: true,
    cta: 'Скоро',
    ctaExternal: null,
    features: [
      { text: 'До 3 кампаний', ok: true },
      { text: 'До 50 публикаций в месяц', ok: true },
      { text: '3 платформы', ok: true },
      { text: 'ИИ-генерация текстов', ok: true },
      { text: '10 генераций изображений ИИ', ok: true },
      { text: 'Планировщик публикаций', ok: true },
      { text: 'Базовая аналитика', ok: true },
      { text: 'Публикация Reels / Stories / Shorts', ok: false },
      { text: 'Telegram-бот управления', ok: false },
      { text: 'Поддержка в чате', ok: false },
    ],
  },
];

const FEATURES = [
  {
    icon: Bot,
    title: 'ИИ пишет за вас',
    description: 'Gemini, Claude, DeepSeek — выбирайте модель. ИИ создаёт тексты, адаптированные под голос вашего бренда.',
  },
  {
    icon: Globe2,
    title: '6 платформ в один клик',
    description: 'Instagram, VK, Telegram, YouTube, Facebook, Threads. Публикуйте везде одновременно.',
  },
  {
    icon: Clock,
    title: 'Планировщик и автопостинг',
    description: 'Настройте расписание — платформа сама опубликует в нужное время. Вы свободны.',
  },
  {
    icon: BarChart3,
    title: 'Аналитика и тренды',
    description: 'Следите за охватами, вовлечённостью и трендами. Экспортируйте отчёты в PDF и Excel.',
  },
  {
    icon: Zap,
    title: 'Автономный режим',
    description: 'ИИ-ассистент сам собирает тренды, генерирует контент и ставит его в очередь. Без вашего участия.',
  },
  {
    icon: Shield,
    title: 'Защита от дублей',
    description: '6-уровневая система защиты гарантирует, что один пост никогда не уйдёт дважды.',
  },
];

const PLATFORMS = [
  { icon: SiInstagram, name: 'Instagram', color: 'text-pink-500' },
  { icon: SiYoutube, name: 'YouTube', color: 'text-red-500' },
  { icon: SiTelegram, name: 'Telegram', color: 'text-blue-400' },
  { icon: SiVk, name: 'ВКонтакте', color: 'text-blue-600' },
  { icon: SiFacebook, name: 'Facebook', color: 'text-blue-700' },
  { icon: SiThreads, name: 'Threads', color: 'text-gray-900 dark:text-white' },
];

const FAQS = [
  {
    q: 'Есть ли пробный период?',
    a: 'Да. После регистрации вы получаете 14 дней полного доступа к тарифу Профессиональный без карты. Доступна 1 кампания, 10 генераций изображений и 10 публикаций постов.',
    color: 'border-blue-500',
  },
  {
    q: 'Можно ли изменить тариф?',
    a: 'Да, в любой момент. Переход на старший тариф работает сразу, на младший — со следующего расчётного периода.',
    color: 'border-green-500',
  },
  {
    q: 'Какие способы оплаты?',
    a: 'Банковские карты через ЮKassa и Stripe, а также банковский перевод для юридических лиц.',
    color: 'border-purple-500',
  },
  {
    q: 'Есть ли возврат?',
    a: 'Если вы не удовлетворены в первые 14 дней — вернём деньги без вопросов.',
    color: 'border-orange-500',
  },
];

type ModalState = 'idle' | 'loading' | 'success' | 'error';

interface AppliedPromo {
  id: string;
  code: string;
  type: 'discount' | 'extra_days' | 'pro_upgrade';
  value: number;
  description: string | null;
}

export default function PricingPage() {
  usePageMeta({
    title: 'Тарифы',
    description: 'SMM Manager — Профессиональный тариф за 670 ₽/мес. Все соцсети, ИИ-генерация, планировщик. 14 дней бесплатно без карты.',
  });

  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userPlan, setUserPlan] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<typeof PLANS[0] | null>(null);
  const [modalState, setModalState] = useState<ModalState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [yookassaAvailable, setYookassaAvailable] = useState(false);

  const [promoInput, setPromoInput] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const promoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const userId = localStorage.getItem('user_id');
    const authenticated = !!(token && userId);
    setIsAuthenticated(authenticated);

    if (authenticated && token) {
      // /api/user/profile возвращает { plan, expire_date, ... }
      fetch('/api/user/profile', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) return;
          const plan: string = data.plan || 'basic';
          const expireDate: string | null = data.expire_date || null;
          // Считаем подписку истёкшей если expire_date задана и прошла
          const isExpired = expireDate ? new Date(expireDate) < new Date() : false;
          setUserPlan(isExpired ? 'free' : plan);
        })
        .catch(() => {});
    }

    fetch('/api/payments/available')
      .then(r => r.json())
      .then(d => setYookassaAvailable(!!d.available))
      .catch(() => setYookassaAvailable(false));
  }, []);

  // Уровень текущего тарифа пользователя (null = не авторизован)
  // trial(0) и free(−1) — показываем все тарифы
  const userPlanLevel = userPlan ? (PLAN_LEVEL[userPlan] ?? 0) : null;
  const hasActivePaidPlan = userPlan && userPlan !== 'trial' && userPlan !== 'free' && userPlan !== 'basic';

  // Фильтруем: пользователям с активным платным тарифом не показываем тарифы ниже
  const visiblePlans = PLANS.filter(plan => {
    if (!hasActivePaidPlan) return true; // гость / trial / free — видит всё
    return (PLAN_LEVEL[plan.key] ?? 0) >= (userPlanLevel ?? 0);
  });

  // Если только одна карточка — центрируем
  const isSingleColumn = visiblePlans.length === 1;

  const handleApplyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    if (!isAuthenticated) {
      navigate('/auth/login');
      return;
    }
    setPromoLoading(true);
    setPromoError('');
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setPromoError(data.error || 'Промокод недействителен');
        return;
      }
      setAppliedPromo(data.promo);
      setPromoInput('');
    } catch {
      setPromoError('Ошибка проверки промокода');
    } finally {
      setPromoLoading(false);
    }
  };

  const clearPromo = () => {
    setAppliedPromo(null);
    setPromoInput('');
    setPromoError('');
  };

  const getDiscountedPrice = (price: number | null): number | null => {
    if (!price || !appliedPromo || appliedPromo.type !== 'discount') return price;
    return Math.round(price * (1 - appliedPromo.value / 100));
  };

  const promoLabel = appliedPromo
    ? appliedPromo.type === 'discount'
      ? `Скидка ${appliedPromo.value}%`
      : appliedPromo.type === 'extra_days'
      ? `+${appliedPromo.value} дней к подписке`
      : `Pro-доступ на ${appliedPromo.value} дней`
    : null;

  const isPlanCurrent = (plan: typeof PLANS[0]) =>
    isAuthenticated && userPlan && userPlan !== 'trial' && userPlan === plan.key;

  const handlePlanClick = (plan: typeof PLANS[0]) => {
    if (isPlanCurrent(plan)) return; // текущий тариф — ничего не делаем
    if (plan.disabled) {
      toast({
        title: 'Скоро доступен',
        description: 'Тариф «' + plan.name + '» появится в ближайшее время. Пока воспользуйтесь тарифом Профессиональный.',
      });
      return;
    }
    if (plan.price === 0) {
      navigate(isAuthenticated ? '/dashboard' : '/auth/register');
      return;
    }
    if (plan.ctaExternal) {
      window.open(plan.ctaExternal, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!isAuthenticated) {
      navigate('/auth/register');
      return;
    }
    setSelectedPlan(plan);
    setModalState('idle');
    setErrorMessage('');
  };

  const handleConfirmRequest = async () => {
    if (!selectedPlan) return;
    const token = localStorage.getItem('auth_token');
    if (!token) {
      navigate('/auth/login');
      return;
    }

    setModalState('loading');
    try {
      const res = await fetch('/api/subscriptions/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan: selectedPlan.name,
          promoCode: appliedPromo?.code || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка сервера');
      }

      setModalState('success');
    } catch (err: any) {
      setErrorMessage(err.message || 'Не удалось отправить заявку');
      setModalState('error');
    }
  };

  const handlePayOnline = async () => {
    if (!selectedPlan) return;
    const token = localStorage.getItem('auth_token');
    if (!token) {
      navigate('/auth/login');
      return;
    }

    setModalState('loading');
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan: selectedPlan.name,
          promoCode: appliedPromo?.code || null,
          amount: finalPrice || selectedPlan.price,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания платежа');
      if (!data.confirmationUrl) throw new Error('Не получен URL оплаты');

      // Сохраняем paymentId чтобы страница успеха могла активировать подписку
      if (data.paymentId) {
        localStorage.setItem('pending_payment_id', data.paymentId);
        localStorage.setItem('pending_payment_plan', selectedPlan.name);
      }

      window.location.href = data.confirmationUrl;
    } catch (err: any) {
      setErrorMessage(err.message || 'Не удалось создать платёж');
      setModalState('error');
    }
  };

  const closeModal = () => {
    setSelectedPlan(null);
    setModalState('idle');
    setErrorMessage('');
  };

  const finalPrice = selectedPlan?.price ? getDiscountedPrice(selectedPlan.price) : null;
  const planPrice = finalPrice
    ? `${finalPrice.toLocaleString('ru-RU')} ₽/мес`
    : 'По договорённости';

  // Показывать ли trial-баннер: только незалогиненным и trial-пользователям
  const showTrialBanner = !isAuthenticated || userPlan === 'trial' || userPlan === null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-gray-950 dark:to-gray-900">

      {/* Nav bar */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-xl font-bold text-gray-900 dark:text-white">SMM Manager</span>
          <div className="flex gap-3">
            {isAuthenticated ? (
              <Link href="/dashboard">
                <Button size="sm" data-testid="link-dashboard">Перейти в приложение</Button>
              </Link>
            ) : (
              <>
                <Link href="/auth/login">
                  <Button variant="ghost" size="sm" data-testid="link-login">Войти</Button>
                </Link>
                <Link href="/auth/register">
                  <Button size="sm" data-testid="link-register">Начать бесплатно</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6">

        {/* Hero */}
        <section className="py-20 text-center">
          <Badge className="mb-6 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-0 px-4 py-1.5 text-sm" data-testid="badge-trial">
            14 дней бесплатно — без карты
          </Badge>
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-6 leading-tight" data-testid="heading-hero">
            Управляйте всеми соцсетями<br />
            <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              с помощью ИИ
            </span>
          </h1>
          <p className="text-xl text-gray-500 dark:text-gray-400 max-w-2xl mx-auto mb-8" data-testid="text-hero-desc">
            Один инструмент вместо пяти. ИИ пишет контент, платформа публикует по расписанию,
            аналитика показывает результат.
          </p>

          {/* Platform icons */}
          <div className="flex items-center justify-center gap-6 mb-10">
            {PLATFORMS.map(({ icon: Icon, name, color }) => (
              <div key={name} className="flex flex-col items-center gap-1.5" title={name}>
                <Icon className={`w-8 h-8 ${color}`} />
                <span className="text-xs text-gray-400">{name}</span>
              </div>
            ))}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-6 max-w-lg mx-auto">
            {[
              { value: '6', label: 'платформ' },
              { value: '5+', label: 'ИИ-моделей' },
              { value: '6x', label: 'быстрее' },
            ].map(({ value, label }) => (
              <div key={label} className="text-center" data-testid={`stat-${label}`}>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">{value}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Plans */}
        <section className="py-4 mb-20">

          {/* Promo code bar — скрываем для пользователей с активным платным тарифом (они ничего не покупают) */}
          {(!isAuthenticated || !userPlan || userPlan === 'trial') && (
            <div className="mb-8">
              {appliedPromo ? (
                <div className="flex items-center justify-between gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 max-w-xl mx-auto">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-800 flex items-center justify-center flex-shrink-0">
                      <Tag className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                        Промокод <span className="font-mono">{appliedPromo.code}</span> применён
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400">{promoLabel}</p>
                    </div>
                  </div>
                  <button
                    onClick={clearPromo}
                    className="text-green-500 hover:text-green-700 dark:hover:text-green-300 transition-colors flex-shrink-0"
                    title="Убрать промокод"
                    data-testid="button-clear-promo"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <div className="max-w-xl mx-auto space-y-1.5">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        ref={promoInputRef}
                        data-testid="input-promo-code-pricing"
                        placeholder="Введите промокод"
                        value={promoInput}
                        onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoError(''); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleApplyPromo()}
                        className="pl-9 font-mono uppercase tracking-wider text-sm"
                      />
                    </div>
                    <Button
                      data-testid="button-apply-promo"
                      onClick={handleApplyPromo}
                      disabled={promoLoading || !promoInput.trim()}
                      variant="outline"
                      className="shrink-0"
                    >
                      {promoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Применить'}
                    </Button>
                  </div>
                  {promoError && (
                    <p className="text-xs text-red-500 pl-1">{promoError}</p>
                  )}
                  {!isAuthenticated && promoInput && (
                    <p className="text-xs text-gray-400 pl-1">
                      <Link href="/auth/login" className="text-blue-500 hover:underline">Войдите</Link>, чтобы применить промокод
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 14-day trial banner — только для незалогиненных и trial-пользователей */}
          {showTrialBanner && (
            <div className="mb-8 max-w-3xl mx-auto bg-gradient-to-r from-blue-50 to-violet-50 dark:from-blue-900/20 dark:to-violet-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl px-6 py-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-800 flex items-center justify-center flex-shrink-0">
                <Clock className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="text-center sm:text-left">
                <p className="font-semibold text-gray-900 dark:text-white text-sm">14 дней бесплатно при первой регистрации</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Полный доступ к тарифу Профессиональный · 1 кампания · 10 генераций изображений · 10 публикаций постов
                </p>
              </div>
              <div className="sm:ml-auto flex-shrink-0">
                {isAuthenticated && userPlan === 'trial' ? (
                  <Link href="/dashboard">
                    <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-trial-cta">
                      Перейти в приложение
                    </Button>
                  </Link>
                ) : (
                  <Link href="/auth/register">
                    <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-trial-cta">
                      Попробовать бесплатно
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Приветствие для пользователей с активным тарифом */}
          {isAuthenticated && userPlan && userPlan !== 'trial' && (
            <div className="mb-8 max-w-3xl mx-auto bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-800 rounded-2xl px-6 py-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-800 flex items-center justify-center flex-shrink-0">
                <Crown className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-center sm:text-left">
                <p className="font-semibold text-gray-900 dark:text-white text-sm">У вас активна подписка</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Для перехода на более высокий тариф оставьте заявку ниже
                </p>
              </div>
              <div className="sm:ml-auto flex-shrink-0">
                <Link href="/dashboard">
                  <Button size="sm" variant="outline" className="border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30" data-testid="button-go-dashboard">
                    Перейти в приложение
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* Non-discount promo banner */}
          {appliedPromo && appliedPromo.type !== 'discount' && (
            <div className="mb-6 max-w-xl mx-auto bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300 text-center">
              Промокод будет применён автоматически после оплаты любого тарифа
            </div>
          )}

          <div className={`grid gap-6 max-w-3xl mx-auto items-start ${
            isSingleColumn
              ? 'grid-cols-1 max-w-sm'
              : visiblePlans.length === 2
              ? 'sm:grid-cols-2'
              : 'sm:grid-cols-3'
          }`}>
            {visiblePlans.map((plan) => {
              const isCurrent = isPlanCurrent(plan);
              return (
                <div key={plan.name} className={`relative ${plan.popular && !isCurrent ? 'md:-mt-4' : ''}`}>
                  {plan.disabled && !isCurrent && (
                    <div className="absolute inset-0 bg-white/60 dark:bg-gray-900/60 rounded-xl z-10 flex items-center justify-center backdrop-blur-[1px]">
                      <span className="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm font-medium px-4 py-2 rounded-full border border-gray-200 dark:border-gray-700">
                        Скоро доступен
                      </span>
                    </div>
                  )}
                  <Card
                    className={`h-full flex flex-col relative ${
                      isCurrent
                        ? 'border-2 border-green-500 shadow-2xl shadow-green-500/10'
                        : plan.popular
                        ? 'border-2 border-blue-500 shadow-2xl shadow-blue-500/10'
                        : 'border border-gray-200 dark:border-gray-700 opacity-70'
                    }`}
                    data-testid={`card-plan-${plan.key}`}
                  >
                    {/* Бейдж "Текущий тариф" или "Лучший выбор" */}
                    {isCurrent ? (
                      <div className="absolute -top-3.5 left-0 right-0 flex justify-center">
                        <span className="bg-green-500 text-white text-xs font-semibold px-4 py-1 rounded-full flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Ваш тариф
                        </span>
                      </div>
                    ) : plan.popular ? (
                      <div className="absolute -top-3.5 left-0 right-0 flex justify-center">
                        <span className="bg-blue-500 text-white text-xs font-semibold px-4 py-1 rounded-full flex items-center gap-1">
                          <Star className="w-3 h-3 fill-white" /> Лучший выбор
                        </span>
                      </div>
                    ) : null}

                    <CardHeader className="pt-8">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-xl text-gray-900 dark:text-white">{plan.name}</CardTitle>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{plan.description}</p>
                        </div>
                        {plan.beta && (
                          <Badge className="shrink-0 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-0 text-xs px-2 py-0.5">
                            Beta
                          </Badge>
                        )}
                      </div>

                      <div className="mt-4">
                        {plan.price === 0 ? (
                          <div className="text-4xl font-bold text-gray-900 dark:text-white">Бесплатно</div>
                        ) : plan.price ? (
                          <div className="flex flex-col gap-0.5">
                            {plan.originalPrice && !appliedPromo && (
                              <span className="text-base font-medium text-red-400 line-through decoration-2">
                                {plan.originalPrice.toLocaleString('ru-RU')} ₽/мес
                              </span>
                            )}
                            {appliedPromo && appliedPromo.type === 'discount' ? (
                              <>
                                <span className="text-base font-medium text-gray-400 line-through decoration-2">
                                  {plan.price.toLocaleString('ru-RU')} ₽/мес
                                </span>
                                <div className="flex items-end gap-1">
                                  <span className="text-4xl font-bold text-green-600 dark:text-green-400">
                                    {getDiscountedPrice(plan.price)!.toLocaleString('ru-RU')} ₽
                                  </span>
                                  <span className="text-gray-400 mb-1">/{plan.period}</span>
                                </div>
                                <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                                  −{appliedPromo.value}% по промокоду {appliedPromo.code}
                                </span>
                              </>
                            ) : (
                              <div className="flex items-end gap-2 flex-wrap">
                                <span className="text-4xl font-bold text-gray-900 dark:text-white">
                                  {plan.price.toLocaleString('ru-RU')} ₽
                                </span>
                                <span className="text-gray-400 mb-1">/{plan.period}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-2xl font-bold text-gray-900 dark:text-white">По договорённости</div>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="flex flex-col flex-1 gap-6">
                      <div className="flex flex-col gap-1.5">
                        {isCurrent ? (
                          // Текущий тариф — кнопка не активная, показываем статус
                          <Button
                            className="w-full bg-green-600 hover:bg-green-600 cursor-default opacity-90"
                            data-testid={`button-cta-${plan.key}`}
                          >
                            <CheckCircle className="w-4 h-4 mr-1.5" />
                            Активен
                          </Button>
                        ) : (
                          <Button
                            className={`w-full ${plan.popular && !plan.disabled ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                            variant={plan.popular && !plan.disabled ? 'default' : 'outline'}
                            data-testid={`button-cta-${plan.key}`}
                            onClick={() => handlePlanClick(plan)}
                          >
                            {plan.ctaExternal ? (
                              <>
                                {plan.cta} <ArrowRight className="w-4 h-4 ml-1" />
                              </>
                            ) : isAuthenticated && !plan.disabled ? (
                              <>
                                <CreditCard className="w-4 h-4 mr-1.5" />
                                {plan.cta}
                              </>
                            ) : (
                              <>
                                {plan.cta} {!plan.disabled && <ArrowRight className="w-4 h-4 ml-1" />}
                              </>
                            )}
                          </Button>
                        )}
                        {plan.disabled && !isCurrent && (
                          <p className="text-xs text-center text-muted-foreground">
                            Тариф в разработке — скоро будет доступен
                          </p>
                        )}
                      </div>

                      <ul className="space-y-2.5">
                        {plan.features.map((f) => (
                          <li key={f.text} className="flex items-start gap-2.5">
                            {f.ok ? (
                              <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                            ) : (
                              <X className="w-4 h-4 text-gray-300 dark:text-gray-600 mt-0.5 flex-shrink-0" />
                            )}
                            <span className={`text-sm ${f.ok ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
                              {f.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </section>

        {/* Features grid */}
        <section className="py-16 border-t border-gray-100 dark:border-gray-800">
          <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-4">
            Почему выбирают нас
          </h2>
          <p className="text-center text-gray-500 dark:text-gray-400 mb-12 max-w-xl mx-auto">
            Всё, что нужно SMM-специалисту — в одном месте, без переключения между вкладками
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="p-6 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-md transition-all"
                data-testid={`card-feature-${title.replace(/\s+/g, '-').toLowerCase()}`}
              >
                <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 border-t border-gray-100 dark:border-gray-800">
          <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-12">
            Частые вопросы
          </h2>
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {FAQS.map(({ q, a, color }) => (
              <div key={q} className={`border-l-4 ${color} pl-5 py-1`} data-testid={`faq-${q.slice(0, 10).replace(/\s/g, '-').toLowerCase()}`}>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-2">{q}</h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="py-16 mb-10">
          <div className="bg-gradient-to-r from-blue-600 to-violet-600 rounded-3xl p-12 text-center text-white">
            <h2 className="text-4xl font-bold mb-4" data-testid="heading-bottom-cta">
              {isAuthenticated && userPlan && userPlan !== 'trial' ? 'Спасибо, что с нами!' : 'Начните прямо сейчас'}
            </h2>
            <p className="text-blue-100 text-lg mb-8 max-w-lg mx-auto">
              {isAuthenticated && userPlan && userPlan !== 'trial'
                ? 'Ваша подписка активна. Управляйте контентом в приложении.'
                : '14 дней полного доступа без карты. Отмените в любой момент.'}
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              {isAuthenticated ? (
                <Link href="/dashboard">
                  <Button
                    size="lg"
                    className="bg-white text-blue-600 hover:bg-blue-50 font-semibold px-8"
                    data-testid="button-cta-final"
                  >
                    Перейти в приложение
                  </Button>
                </Link>
              ) : (
                <>
                  <Link href="/auth/register">
                    <Button
                      size="lg"
                      className="bg-white text-blue-600 hover:bg-blue-50 font-semibold px-8"
                      data-testid="button-cta-final"
                    >
                      Создать аккаунт — бесплатно
                    </Button>
                  </Link>
                  <Link href="/auth/login">
                    <Button
                      size="lg"
                      variant="ghost"
                      className="text-white border border-white/30 hover:bg-white/10"
                      data-testid="button-login-final"
                    >
                      Уже есть аккаунт
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

      </div>

      {/* Footer */}
      <footer className="border-t border-gray-100 dark:border-gray-800 py-8 text-center text-sm text-gray-400">
        <p>© {new Date().getFullYear()} SMM Manager · <a href="https://omemo.tech" className="hover:text-gray-600 transition-colors">omemo.tech</a></p>
      </footer>

      {/* Purchase confirmation modal */}
      <Dialog open={!!selectedPlan} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-md" data-testid="modal-purchase">
          {modalState === 'success' ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Заявка отправлена!
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm leading-relaxed">
                Администратор получил уведомление и активирует тариф <strong>{selectedPlan?.name}</strong> в течение рабочего дня.<br /><br />
                По вопросам обращайтесь:{' '}
                <a href="https://t.me/omemo_tech" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                  @omemo_tech
                </a>
              </p>
              <Button onClick={closeModal} className="w-full" data-testid="button-close-success">
                Хорошо
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Оформление тарифа</DialogTitle>
                <DialogDescription>
                  Тариф <strong>{selectedPlan?.name}</strong> · {planPrice}
                  {appliedPromo && appliedPromo.type !== 'discount' && (
                    <span className="ml-2 text-blue-600 text-xs">+ промокод {appliedPromo.code}</span>
                  )}
                </DialogDescription>
              </DialogHeader>

              {modalState === 'error' && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400" data-testid="error-modal">
                  {errorMessage}
                </div>
              )}

              <div className="flex flex-col gap-3 mt-2">
                {yookassaAvailable && (
                  <Button
                    onClick={handlePayOnline}
                    disabled={modalState === 'loading'}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    data-testid="button-pay-online"
                  >
                    {modalState === 'loading' ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CreditCard className="w-4 h-4 mr-2" />
                    )}
                    Оплатить картой онлайн
                  </Button>
                )}
                <Button
                  onClick={handleConfirmRequest}
                  disabled={modalState === 'loading'}
                  variant={yookassaAvailable ? 'outline' : 'default'}
                  className="w-full"
                  data-testid="button-request-subscription"
                >
                  {modalState === 'loading' ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Отправить заявку администратору
                </Button>
              </div>

              <p className="text-xs text-center text-gray-400 mt-1">
                После оплаты или отправки заявки администратор активирует тариф в течение рабочего дня
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
