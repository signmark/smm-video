export type PlanType = 'free' | 'basic' | 'trial' | 'pro' | 'enterprise';

export interface PlanLimits {
  maxCampaigns: number | null;
  maxPostsPerMonth: number | null;
  allowedNetworks: string[] | null;
  aiImageGeneration: boolean;
  aiImageGenerationsPerMonth: number | null;
  advancedAnalytics: boolean;
  exportReports: boolean;
  telegramBot: boolean;
  apiAccess: boolean;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    maxCampaigns: 0,
    maxPostsPerMonth: 0,
    allowedNetworks: [],
    aiImageGeneration: false,
    aiImageGenerationsPerMonth: 0,
    advancedAnalytics: false,
    exportReports: false,
    telegramBot: false,
    apiAccess: false,
  },
  // Пробный период 14 дней — весь функционал, ограниченные лимиты
  trial: {
    maxCampaigns: 1,
    maxPostsPerMonth: 10,
    allowedNetworks: null,
    aiImageGeneration: true,
    aiImageGenerationsPerMonth: 10,
    advancedAnalytics: true,
    exportReports: true,
    telegramBot: true,
    apiAccess: false,
  },
  basic: {
    maxCampaigns: 5,
    maxPostsPerMonth: 100,
    allowedNetworks: null,
    aiImageGeneration: true,
    aiImageGenerationsPerMonth: 30,
    advancedAnalytics: false,
    exportReports: false,
    telegramBot: false,
    apiAccess: false,
  },
  pro: {
    maxCampaigns: null,
    maxPostsPerMonth: null,
    allowedNetworks: null,
    aiImageGeneration: true,
    aiImageGenerationsPerMonth: null,
    advancedAnalytics: true,
    exportReports: true,
    telegramBot: true,
    apiAccess: false,
  },
  enterprise: {
    maxCampaigns: null,
    maxPostsPerMonth: null,
    allowedNetworks: null,
    aiImageGeneration: true,
    aiImageGenerationsPerMonth: null,
    advancedAnalytics: true,
    exportReports: true,
    telegramBot: true,
    apiAccess: true,
  },
};

export const PLAN_LABELS: Record<PlanType, string> = {
  free: 'Пробный период истёк',
  trial: 'Пробный период',
  basic: 'Базовый',
  pro: 'Профессиональный',
  enterprise: 'Корпоративный',
};

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  const p = (plan || 'free') as PlanType;
  return PLAN_LIMITS[p] ?? PLAN_LIMITS.free;
}

export function getPlanLabel(plan: string | null | undefined): string {
  const p = (plan || 'free') as PlanType;
  return PLAN_LABELS[p] ?? PLAN_LABELS.free;
}
