import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Провал refresh ≠ смерть access-токена.
 *
 * Прод 29.07.2026: в 08:24:19 server-side refresh прошёл и VK ротировал
 * одноразовый refresh-токен; в 08:27:33 повторная отправка из needanapp
 * применила прежний экземпляр — VK ответил «session is compromised because
 * refresh token has already been applied»; в 08:38:13 крон получил
 * invalid_grant, пометил кампанию authExpired и написал владельцу в Telegram.
 * Access-токен при этом был жив ещё 49 минут — до 09:27:42.
 */

vi.mock('../utils/logger', () => ({ log: vi.fn() }));
vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  get: vi.fn(), post: vi.fn(), patch: vi.fn(),
}));
vi.mock('./email', () => ({ sendEmail: vi.fn() }));
vi.mock('../services/email', () => ({ sendEmail: vi.fn() }));

const validateVkToken = vi.fn();
vi.mock('../services/social-api-validator', () => ({ validateVkToken }));

/**
 * Проверяем возвращаемое значение: true = «признали токен мёртвым и погасили
 * кампанию». Перехватывать внутренний вызов markVkAuthExpired через vi.spyOn
 * по экспорту в ESM нельзя — модуль зовёт свою локальную привязку, и спай
 * создавал бы лишь видимость проверки. Запись в Directus здесь не происходит:
 * axios замокан, а markVkAuthExpired свои ошибки гасит сам.
 */
describe('markVkAuthExpiredIfTokenDead', () => {
  let subject: typeof import('../services/vk-token-refresh');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.DIRECTUS_URL = 'https://directus.test';
    process.env.DIRECTUS_STATIC_TOKEN = 'static-admin-token-for-tests';
    subject = await import('../services/vk-token-refresh');
  });

  it('access-токен жив → кампанию НЕ гасим', async () => {
    validateVkToken.mockResolvedValue({ isValid: true, message: 'Токен валиден', details: { id: 1 } });

    const marked = await subject.markVkAuthExpiredIfTokenDead(
      'campaign-1', 'vk2.живой', 'invalid_grant — refresh token has already been applied');

    expect(marked).toBe(false);
    expect(validateVkToken).toHaveBeenCalledWith('vk2.живой');
  });

  it('VK сам лежит (код 10) → вердикт неубедителен, не гасим', async () => {
    validateVkToken.mockResolvedValue({
      isValid: false,
      message: 'Internal server error',
      details: { error: { error_code: 10, error_msg: 'Internal server error: could not check access_token now, check later.' } },
    });

    const marked = await subject.markVkAuthExpiredIfTokenDead('campaign-1', 'vk2.неизвестно', 'invalid_grant');

    expect(marked).toBe(false);
  });

  it('заблокированное приложение (код 8) → не гасим: переподключение не поможет', async () => {
    validateVkToken.mockResolvedValue({
      isValid: false,
      message: 'Application is blocked',
      details: { error: { error_code: 8, error_msg: 'Invalid request: Application is blocked' } },
    });

    expect(await subject.markVkAuthExpiredIfTokenDead('campaign-1', 'vk2.токен', 'invalid_grant')).toBe(false);
  });

  it('сеть/таймаут при проверке → не гасим', async () => {
    validateVkToken.mockResolvedValue({ isValid: false, message: 'timeout', details: undefined });

    expect(await subject.markVkAuthExpiredIfTokenDead('campaign-1', 'vk2.токен', 'invalid_grant')).toBe(false);
  });

  it('access-токен действительно мёртв (код 5) → гасим', async () => {
    validateVkToken.mockResolvedValue({
      isValid: false,
      message: 'User authorization failed',
      details: { error: { error_code: 5, error_msg: 'User authorization failed: invalid access_token (4).' } },
    });

    expect(await subject.markVkAuthExpiredIfTokenDead('campaign-1', 'vk2.мёртвый', 'invalid_grant')).toBe(true);
  });

  it('access-токена нет вовсе → гасим (проверять нечего)', async () => {
    expect(await subject.markVkAuthExpiredIfTokenDead('campaign-1', undefined, 'invalid_grant')).toBe(true);
    expect(validateVkToken).not.toHaveBeenCalled();
  });
});

describe('VK_REFRESH_LEAD_MS', () => {
  it('меньше часа жизни токена VK ID — свежий токен не попадает под обновление', async () => {
    const { VK_REFRESH_LEAD_MS } = await import('../services/vk-token-refresh');
    const VK_ID_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

    expect(VK_REFRESH_LEAD_MS).toBeLessThan(VK_ID_TOKEN_LIFETIME_MS);
    // И при этом больше интервала крона (30 мин) — токен успеваем поймать.
    expect(VK_REFRESH_LEAD_MS).toBeGreaterThan(30 * 60 * 1000);
  });
});
