/**
 * Unit-тесты: partner-postback.ts
 *
 * Покрывают:
 *   P01-P03  sendRegistrationPostback — payload, guard-условия
 *   P04-P06  sendPurchasePostback     — payload, guard-условия
 *   P07-P09  Обработка ошибок сети и HTTP
 *   P10-P12  Нормализация кода (uppercase, trim)
 *
 * Запуск:
 *   npx vitest run server/__tests__/partner-postback.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// --------------------------------------------------------------------------
// Утилиты
// --------------------------------------------------------------------------

/** Возвращает свежий импорт модуля с нужным env */
async function importPostback(secret = 'test-secret', url?: string) {
  vi.resetModules();
  // AI-89: OMEMO_POSTBACK_URL теперь обязательная (getRequiredServiceUrl).
  // Ставим её по умолчанию, чтобы каждый тест работал как раньше.
  // Тест, который хочет проверить именно отсутствие URL, должен
  // вызвать vi.unstubEnv('OMEMO_POSTBACK_URL') сам.
  vi.stubEnv('OMEMO_POSTBACK_URL', url ?? 'https://postback.example.com');
  vi.stubEnv('OMEMO_POSTBACK_SECRET', secret);
  return await import('../services/partner-postback.js');
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // AI-89: OMEMO_POSTBACK_URL обязательная, ставим по умолчанию
  vi.stubEnv('OMEMO_POSTBACK_URL', 'https://postback.example.com');
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// --------------------------------------------------------------------------
// P01-P03  sendRegistrationPostback
// --------------------------------------------------------------------------

describe('sendRegistrationPostback', () => {
  it('P01 отправляет POST с корректным payload при наличии partnerCode и secret', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => 'ok',
    });

    vi.stubEnv('OMEMO_POSTBACK_SECRET', 'mysecret');
    vi.stubEnv('OMEMO_POSTBACK_URL', 'https://postback.example.com');
    vi.resetModules();
    const { sendRegistrationPostback } = await import('../services/partner-postback.js');

    await sendRegistrationPostback({
      partnerCode: 'PARTNER123',
      userId: 'user-abc',
      email: 'test@example.com',
      telegramId: '123456789',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('postback');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe('Bearer mysecret');
    expect(opts.headers['X-Omemo-Token']).toBe('mysecret');

    const body = JSON.parse(opts.body);
    expect(body.event_type).toBe('registration');
    expect(body.partner_code).toBe('PARTNER123');
    expect(body.transaction_id).toContain('user-abc');
    expect(body.buyer_email).toBe('test@example.com');
    expect(body.buyer_telegram_id).toBe('123456789');
    expect(body.source_app).toBe('smmhub');
    expect(body.schema_version).toBe('1.0');
    expect(body.product_id).toBe(5);
  });

  it('P02 НЕ отправляет запрос если OMEMO_POSTBACK_SECRET пустой', async () => {
    vi.stubEnv('OMEMO_POSTBACK_SECRET', '');
    vi.resetModules();
    const { sendRegistrationPostback } = await import('../services/partner-postback.js');

    await sendRegistrationPostback({ partnerCode: 'PARTNER123', userId: 'u1' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('P03 НЕ отправляет запрос если partnerCode пустой', async () => {
    vi.stubEnv('OMEMO_POSTBACK_SECRET', 'mysecret');
    vi.resetModules();
    const { sendRegistrationPostback } = await import('../services/partner-postback.js');

    await sendRegistrationPostback({ partnerCode: '', userId: 'u1' });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// P04-P06  sendPurchasePostback
// --------------------------------------------------------------------------

describe('sendPurchasePostback', () => {
  it('P04 отправляет purchase-постбек с корректным payload', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => 'ok' });

    vi.stubEnv('OMEMO_POSTBACK_SECRET', 'mysecret');
    vi.resetModules();
    const { sendPurchasePostback } = await import('../services/partner-postback.js');

    await sendPurchasePostback({
      partnerCode: 'PARTNER123',
      userId: 'user-abc',
      paymentId: 'pay-xyz',
      amount: 1990,
      email: 'buyer@example.com',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.event_type).toBe('purchase');
    expect(body.amount).toBe(1990);
    expect(body.transaction_id).toContain('pay-xyz');
    expect(body.partner_code).toBe('PARTNER123');
  });

  it('P05 НЕ отправляет purchase-постбек если secret пустой', async () => {
    vi.stubEnv('OMEMO_POSTBACK_SECRET', '');
    vi.resetModules();
    const { sendPurchasePostback } = await import('../services/partner-postback.js');

    await sendPurchasePostback({ partnerCode: 'P', userId: 'u', paymentId: 'pay', amount: 0 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('P06 НЕ отправляет purchase-постбек если partnerCode пустой', async () => {
    vi.stubEnv('OMEMO_POSTBACK_SECRET', 'mysecret');
    vi.resetModules();
    const { sendPurchasePostback } = await import('../services/partner-postback.js');

    await sendPurchasePostback({ partnerCode: '', userId: 'u', paymentId: 'pay', amount: 100 });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// P07-P09  Обработка ошибок
// --------------------------------------------------------------------------

describe('Обработка ошибок сети и HTTP', () => {
  it('P07 сетевая ошибка (fetch throws) не пробрасывается наружу', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    vi.stubEnv('OMEMO_POSTBACK_SECRET', 'mysecret');
    vi.resetModules();
    const { sendRegistrationPostback } = await import('../services/partner-postback.js');

    await expect(
      sendRegistrationPostback({ partnerCode: 'P', userId: 'u' })
    ).resolves.toBeUndefined();
  });

  it('P08 HTTP 403 — функция завершается без throw', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    vi.stubEnv('OMEMO_POSTBACK_SECRET', 'mysecret');
    vi.resetModules();
    const { sendRegistrationPostback } = await import('../services/partner-postback.js');

    await expect(
      sendRegistrationPostback({ partnerCode: 'P', userId: 'u' })
    ).resolves.toBeUndefined();
  });

  it('P09 HTTP 500 — функция завершается без throw', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    vi.stubEnv('OMEMO_POSTBACK_SECRET', 'mysecret');
    vi.resetModules();
    const { sendPurchasePostback } = await import('../services/partner-postback.js');

    await expect(
      sendPurchasePostback({ partnerCode: 'P', userId: 'u', paymentId: 'pay', amount: 500 })
    ).resolves.toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// P10-P12  Нормализация и поля по умолчанию
// --------------------------------------------------------------------------

describe('Нормализация и значения по умолчанию', () => {
  it('P10 transaction_id для registration содержит userId', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => '' });

    vi.stubEnv('OMEMO_POSTBACK_SECRET', 'sec');
    vi.resetModules();
    const { sendRegistrationPostback } = await import('../services/partner-postback.js');

    await sendRegistrationPostback({ partnerCode: 'P', userId: 'u-777' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.transaction_id).toMatch(/u-777/);
  });

  it('P11 transaction_id для purchase содержит paymentId', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => '' });

    vi.stubEnv('OMEMO_POSTBACK_SECRET', 'sec');
    vi.resetModules();
    const { sendPurchasePostback } = await import('../services/partner-postback.js');

    await sendPurchasePostback({ partnerCode: 'P', userId: 'u', paymentId: 'pay-999', amount: 0 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.transaction_id).toMatch(/pay-999/);
  });

  it('P12 product_id по умолчанию = 5 если не передан', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => '' });

    vi.stubEnv('OMEMO_POSTBACK_SECRET', 'sec');
    vi.resetModules();
    const { sendRegistrationPostback } = await import('../services/partner-postback.js');

    await sendRegistrationPostback({ partnerCode: 'P', userId: 'u' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.product_id).toBe(5);
  });
});
