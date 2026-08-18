/**
 * AI-65: человек заплатил, тариф выдали — и не сказали ему.
 *
 * ЧТО БЫЛО. Подтверждение об активации подписки отправляется из двух мест:
 * одобрение администратором в боте и одобрение по ссылке из письма. В обоих
 * отказ проглатывался целиком (`catch (_) {}` плюс `.catch(() => {})` на самой
 * отправке), а `validateStatus: () => true` превращал отказ Telegram в обычный
 * ответ, на который никто не смотрел. Самый частый живой случай — человек не
 * начинал диалог с ботом или заблокировал его — выглядел как успешная отправка.
 * Снаружи это «я оплатил, мне ничего не пришло», и на этот вопрос в журнале не
 * было ни одной строки.
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Помощник проверяется поведением: настоящая отправка через
 * подменённый транспорт, событие ловится на границе логгера. Места вызова —
 * сканером исходника (правило 49): поднимать бот с Telegram и Directus целиком
 * ради двух ветвлений нецелесообразно.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { logEvent } from '../utils/logger';
import { notifySubscriptionActivated } from '../services/subscription-notify';

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));

vi.mock('../services/social-platforms/telegram-http', () => ({
  telegramHttp: async () => ({ post: postMock }),
  getTelegramAgent: () => undefined,
}));

vi.mock('../utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/logger')>();
  return { ...actual, logEvent: vi.fn() };
});

const mockLogEvent = logEvent as unknown as ReturnType<typeof vi.fn>;

const UNDELIVERED = 'subscription.confirmation_undelivered';
const undeliveredCalls = () => mockLogEvent.mock.calls.filter((c) => c[0] === UNDELIVERED);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
});

const ACTIVATED = {
  userId: 'user-1',
  chatId: 555,
  text: '🎉 Подписка активирована!\n📦 Тариф: pro',
};

describe('AI-65: недоставленное подтверждение подписки перестало быть невидимым', () => {
  it('Telegram отказал — это записано, а не проглочено', async () => {
    // 403 «bot was blocked by the user». Прежний код с validateStatus считал это
    // обычным ответом и шёл дальше молча.
    postMock.mockResolvedValue({ status: 403, data: { ok: false } });

    await notifySubscriptionActivated(ACTIVATED);

    const [call] = undeliveredCalls();
    expect(call, 'отказ Telegram обязан оставить след').toBeTruthy();
    expect(call[1].reason).toBe('telegram_rejected');
    expect(call[1].status).toBe(403);
    expect(call[1].userId).toBe('user-1');
    expect(call[2]).toBe('warn');
  });

  it('транспорт не дошёл — причина сохранена из ошибки', async () => {
    postMock.mockRejectedValue(new Error('ETIMEDOUT'));

    await notifySubscriptionActivated(ACTIVATED);

    const [call] = undeliveredCalls();
    expect(call).toBeTruthy();
    expect(call[1].reason).toBe('ETIMEDOUT');
    expect(call[1].provider).toBe('telegram');
  });

  it('отправлять нечем — сказано об этом, а не сделан вид отправки', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;

    await notifySubscriptionActivated(ACTIVATED);

    expect(postMock, 'без токена запрос уходить не должен').not.toHaveBeenCalled();
    expect(undeliveredCalls()[0][1].reason).toBe('bot_token_missing');
  });

  it('доставлено — в журнале тишина', async () => {
    postMock.mockResolvedValue({ status: 200, data: { ok: true } });

    await notifySubscriptionActivated(ACTIVATED);

    expect(undeliveredCalls(), 'успех не должен шуметь').toHaveLength(0);
  });
});

describe('AI-65: отказ подтверждения не отменяет выданную подписку', () => {
  it('помощник не бросает ни при каком исходе', async () => {
    postMock.mockRejectedValue(new Error('boom'));
    await expect(notifySubscriptionActivated(ACTIVATED)).resolves.toBeUndefined();

    postMock.mockResolvedValue({ status: 500, data: {} });
    await expect(notifySubscriptionActivated(ACTIVATED)).resolves.toBeUndefined();
  });

  it('в событие не уходит ни текст сообщения, ни адресат', async () => {
    postMock.mockResolvedValue({ status: 400, data: { description: 'chat not found' } });

    await notifySubscriptionActivated(ACTIVATED);

    const fields = JSON.stringify(undeliveredCalls()[0][1]);
    // Журнал — про факт и причину. Содержимое переписки и chat_id туда не идут.
    expect(fields).not.toContain('Тариф');
    expect(fields).not.toContain('555');
  });
});

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8');

describe('AI-65: оба места выдачи подписки пользуются одним решением', () => {
  it('одобрение в боте зовёт помощник и не глотает отказ', () => {
    const s = read('telegram-bot/index.ts');
    expect(s).toContain('notifySubscriptionActivated');
    expect(s).toContain(UNDELIVERED);
    expect(s).not.toMatch(/catch \(_\) \{\}/);
  });

  it('одобрение по ссылке из письма зовёт тот же помощник', () => {
    const s = read('routes/subscriptions.ts');
    expect(s).toContain('notifySubscriptionActivated');
    expect(s).toContain(UNDELIVERED);
    expect(s).not.toMatch(/catch \(_\) \{\}/);
  });

  it('непрочитанный получатель отличим от отсутствующего', () => {
    // Две разные починки: в первом случае сломан Directus, во втором человек
    // просто не привязывал Telegram. Одно событие с разными причинами.
    for (const rel of ['telegram-bot/index.ts', 'routes/subscriptions.ts']) {
      const s = read(rel);
      expect(s, rel).toContain("reason: 'chat_id_unreadable'");
      expect(s, rel).toContain("reason: 'chat_id_missing'");
    }
  });
});

describe('AI-65: остальные молчания этого прохода названы', () => {
  it('постбек партнёру о регистрации уйдёт с неполными данными — это видно', () => {
    const s = read('api/auth-routes.ts');
    const idx = s.indexOf("'auth.postback_identity_unresolved'");
    expect(idx).toBeGreaterThan(0);
    const call = s.slice(idx, idx + 300);
    expect(call).toContain('userId');
    expect(call).toContain("'warn'");
    // Регистрация состоялась — проброс отменил бы её из-за второстепенного.
    expect(call).not.toMatch(/\bthrow\b/);
  });

  it('отказ партнёрского постбека назван, а ответ партнёра в событие не уходит', () => {
    const s = read('services/partner-postback.ts');
    const idx = s.indexOf("'partner.postback_failed'");
    expect(idx).toBeGreaterThan(0);
    // Ответ партнёрского API остаётся в консоли: там может быть что угодно.
    expect(s.slice(idx, idx + 600)).not.toContain('${text}');
    expect(s).toContain("reason: 'rejected'");
  });

  it('перебор путей к Chromium молчит намеренно, а исход перебора записан', () => {
    const s = read('services/web-crawler-agent.ts');
    // Пустой catch в переборе кандидатов оставлен сознательно — «нет такого
    // файла» это обычный ответ. Но он обязан быть объяснён.
    const loop = s.slice(s.indexOf('for (const path of possiblePaths)'), s.indexOf('puppeteer.launch(launchOptions)'));
    expect(loop).toContain('AI-65');
    expect(loop).toContain('crawler.chromium_not_found');
    expect(loop).toContain("'warn'");
  });
});
