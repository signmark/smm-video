import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store';
import { PROFILE_FRESHNESS } from './profile-freshness';

export type PlanType = 'free' | 'basic' | 'trial' | 'pro' | 'enterprise';

export interface PlanLimits {
  maxCampaigns: number | null;
  maxPostsPerMonth: number | null;
  allowedNetworks: string[] | null; // null = all networks allowed
  maxConnectedAccounts: number | null; // null = unlimited
  aiImageGeneration: boolean;
  maxImageGenerationsPerMonth: number | null; // null = unlimited
  advancedAnalytics: boolean;
  exportReports: boolean;
  telegramBot: boolean;
  apiAccess: boolean;
  support: boolean;
}

const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  // Пробный период истёк или нет активной подписки — всё заблокировано
  free: {
    maxCampaigns: 0,
    maxPostsPerMonth: 0,
    allowedNetworks: [],
    maxConnectedAccounts: 0,
    aiImageGeneration: false,
    maxImageGenerationsPerMonth: 0,
    advancedAnalytics: false,
    exportReports: false,
    telegramBot: false,
    apiAccess: false,
    support: false,
  },
  // Пробный период 14 дней — весь функционал, но ограниченные лимиты
  trial: {
    maxCampaigns: 1,
    maxPostsPerMonth: 10,
    allowedNetworks: null,
    maxConnectedAccounts: null,
    aiImageGeneration: true,
    maxImageGenerationsPerMonth: 10,
    advancedAnalytics: true,
    exportReports: true,
    telegramBot: true,
    apiAccess: false,
    support: false,
  },
  basic: {
    maxCampaigns: 5,
    maxPostsPerMonth: 100,
    allowedNetworks: null,
    maxConnectedAccounts: 3,
    aiImageGeneration: true,
    maxImageGenerationsPerMonth: 30,
    advancedAnalytics: false,
    exportReports: false,
    telegramBot: false,
    apiAccess: false,
    support: false,
  },
  pro: {
    maxCampaigns: null,
    maxPostsPerMonth: null,
    allowedNetworks: null,
    maxConnectedAccounts: null,
    aiImageGeneration: true,
    maxImageGenerationsPerMonth: null,
    advancedAnalytics: true,
    exportReports: true,
    telegramBot: true,
    apiAccess: false,
    support: true,
  },
  enterprise: {
    maxCampaigns: null,
    maxPostsPerMonth: null,
    allowedNetworks: null,
    maxConnectedAccounts: null,
    aiImageGeneration: true,
    maxImageGenerationsPerMonth: null,
    advancedAnalytics: true,
    exportReports: true,
    telegramBot: true,
    apiAccess: true,
    support: true,
  },
};

export const PLAN_LABELS: Record<PlanType, string> = {
  free: 'Пробный период истёк',
  trial: 'Пробный период',
  basic: 'Базовый',
  pro: 'Профессиональный',
  enterprise: 'Корпоративный',
};

export function usePlan() {
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);

  const { data: profile } = useQuery<{
    plan?: string;
    expire_date?: string | null;
    is_smm_admin?: boolean;
  }>({
    queryKey: ['/api/user/profile', userId || 'me'],
    enabled: !!token,
    ...PROFILE_FRESHNESS,
  });

  const plan = (profile?.plan || 'basic') as PlanType;
  const expireDate = profile?.expire_date ?? null;
  const isAdmin = profile?.is_smm_admin === true;

  // Подписка истекла если expire_date задана и уже прошла.
  // На админов правило не распространяется — их доступ не зависит от даты тарифа.
  const isExpired = !isAdmin && expireDate
    ? new Date(expireDate) < new Date()
    : false;

  // Если срок действия истёк — пользователь в состоянии "free" (нет активной подписки).
  // Базовый тариф тоже платный, поэтому не даём его бесплатно.
  const effectivePlan: PlanType = isExpired ? 'free' : plan;
  const limits = PLAN_LIMITS[effectivePlan] ?? PLAN_LIMITS.free;
  const label = PLAN_LABELS[effectivePlan] ?? PLAN_LABELS.free;

  const isTrial = !isExpired && plan === 'trial';

  return {
    plan,
    effectivePlan,
    limits,
    label,
    expireDate,
    isExpired,
    isTrial,
    isPro: !isExpired && (plan === 'pro' || plan === 'enterprise'),
    isEnterprise: !isExpired && plan === 'enterprise',
  };
}
