/**
 * AI-105: генератор промта ассистента обязан брать тематику кампании из
 * business_questionnaire.
 *
 * Породивший случай: кампания «Мир гранита» (натуральный камень) получила
 * обезличенный SMM-промт. Причина — код читал `camp.target_audience` и
 * `camp.business_description`, колонок с такими именами в `user_campaigns` нет,
 * оба условия были ложны всегда, и в модель уходили дефолты.
 *
 * Гоняется РЕАЛЬНЫЙ registerCampaignRoutes в мини-Express; на границах моками
 * закрыты authenticateUser, Directus и модель. Проверяется ФАКТИЧЕСКИЙ запрос,
 * ушедший в модель, а не возвращённый текст: тематику теряли именно на входе.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => {
  return {
    getById: vi.fn(),
    list: vi.fn(),
    generateContent: vi.fn(),
  };
});

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (req: any, _res: any, next: () => void) => {
    req.user = { id: 'user-1', token: 'token-1' };
    next();
  },
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: { getById: H.getById, list: H.list, update: vi.fn() },
}));

vi.mock('../services/ai-service', () => ({
  aiService: { generateContent: H.generateContent },
}));

// Тяжёлые зависимости campaigns.ts, не нужные на этом пути.
vi.mock('../directus', () => ({
  directusApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  directusApiManager: { request: vi.fn(), cacheAuthToken: vi.fn(), instance: { interceptors: { response: { use: vi.fn() } } } },
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('axios', () => {
  const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  const instance: any = {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(), interceptors,
  };
  return { default: { get: vi.fn(), post: vi.fn(), create: () => instance, interceptors }, create: () => instance, interceptors };
});
vi.mock('../routes-global-api-keys', () => ({ isUserAdmin: vi.fn(async () => false) }));
vi.mock('../services/web-crawler-agent', () => ({ webCrawlerAgent: {} }));
vi.mock('../utils/ai-helpers', () => ({ extractFullSiteContent: vi.fn() }));
vi.mock('../services/admin-token-manager', () => ({ adminTokenManager: { getToken: vi.fn(async () => 'admin-token') } }));
vi.mock('../services/plan-limits', () => ({ getPlanLimits: vi.fn(() => ({})), getEffectivePlan: vi.fn(() => 'free') }));
vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn };
});

import { registerCampaignRoutes } from '../routes/campaigns';

const app = express();
app.use(express.json());
registerCampaignRoutes(app);

const PAYLOAD = {
  role: 'SMM-менеджер',
  experience: '1-2 года',
  knowledge: ['SMM', 'E-commerce'],
  skills: ['копирайтинг'],
  tone: 'экспертный',
  postLength: 'средняя',
  contentMix: { educational: 33, entertaining: 33, selling: 34 },
};

// Реальные поля кампании из отчёта тестировщика (сокращены).
const GRANITE_CAMPAIGN = {
  id: 'camp-granite',
  name: 'Мир гранита',
  description: 'Группа компаний «Возрождение Торговый Дом» — полный цикл работ с натуральным камнем.',
  social_media_settings: { telegram: { enabled: true, chatId: 'x', token: 'secret' } },
};

const GRANITE_QUESTIONNAIRE = {
  campaign_id: 'camp-granite',
  company_name: 'ООО «Управляющая Компания Возрождение Торговый Дом»',
  business_description: 'Надёжный партнёр по работе с натуральным камнем: гранит, мрамор, известняк, травертин.',
  main_directions: 'Ландшафтный дизайн, мощение, облицовка зданий, благоустройство территорий',
  products_services: 'Плиты мощения, брусчатка, бордюры, ступени',
  target_audience: 'Компании и частные лица, занимающиеся строительством и благоустройством территорий',
  competitive_advantages: 'Собственные карьеры и полный цикл обработки',
};

function capturePrompt(): () => string {
  let captured = '';
  H.generateContent.mockImplementation(async (opts: { prompt: string }) => {
    captured = opts.prompt;
    return { content: 'Ты — SMM-менеджер с опытом 1-2 года. Пиши для [socialNetworks]. '.repeat(4) };
  });
  return () => captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  H.getById.mockResolvedValue(GRANITE_CAMPAIGN);
  H.list.mockResolvedValue([GRANITE_QUESTIONNAIRE]);
});

describe('POST /api/campaigns/:campaignId/generate-assistant-prompt — тематика кампании (AI-105)', () => {
  it('передаёт в модель бизнес-контекст и аудиторию из анкеты кампании', async () => {
    const prompt = capturePrompt();

    const res = await request(app)
      .post('/api/campaigns/camp-granite/generate-assistant-prompt')
      .send(PAYLOAD);

    expect(res.status).toBe(200);
    const sent = prompt();

    // Главное: модель узнаёт, чем занимается кампания.
    expect(sent).toContain('КОНТЕКСТ БИЗНЕСА');
    expect(sent).toContain('натуральным камнем');
    expect(sent).toContain('Ландшафтный дизайн');
    expect(sent).toContain('Возрождение Торговый Дом');

    // И берёт аудиторию из анкеты, а не дефолтную заглушку.
    expect(sent).toContain('Компании и частные лица');
    expect(sent).not.toContain('Целевая аудитория: широкая аудитория');

    // Анкета запрошена по своей кампании, а не «вообще».
    expect(H.list).toHaveBeenCalledWith(
      'business_questionnaire',
      expect.objectContaining({
        authToken: 'token-1',
        filter: { campaign_id: { _eq: 'camp-granite' } },
      }),
    );
  });

  it('без анкеты падает на описание кампании, а не на заглушку', async () => {
    H.list.mockResolvedValue([]);
    const prompt = capturePrompt();

    const res = await request(app)
      .post('/api/campaigns/camp-granite/generate-assistant-prompt')
      .send(PAYLOAD);

    expect(res.status).toBe(200);
    const sent = prompt();
    expect(sent).toContain('КОНТЕКСТ БИЗНЕСА');
    expect(sent).toContain('натуральным камнем');
  });

  it('пустая анкета не затирает описание кампании', async () => {
    // Запись есть, но все поля пустые — раньше такой случай подменил бы контекст пустотой.
    H.list.mockResolvedValue([{ campaign_id: 'camp-granite', company_name: '', business_description: '' }]);
    const prompt = capturePrompt();

    const res = await request(app)
      .post('/api/campaigns/camp-granite/generate-assistant-prompt')
      .send(PAYLOAD);

    expect(res.status).toBe(200);
    expect(prompt()).toContain('натуральным камнем');
  });

  it('недоступная анкета не ломает генерацию промта', async () => {
    // Директус может ответить ошибкой — это не повод падать: промт нужен,
    // пусть и обеднённый описанием кампании.
    H.list.mockRejectedValue(new Error('directus 503'));
    const prompt = capturePrompt();

    const res = await request(app)
      .post('/api/campaigns/camp-granite/generate-assistant-prompt')
      .send(PAYLOAD);

    expect(res.status).toBe(200);
    expect(prompt()).toContain('натуральным камнем');
  });
});
