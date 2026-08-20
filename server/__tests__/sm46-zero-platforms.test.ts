import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkAllPlatforms, platformsWithCredentials } from '../services/connection-check';

/**
 * SM-46: «Проверить сейчас» при 0 настроенных площадок должно говорить «проверять нечего»,
 * а не success. checkAllPlatforms в этом случае возвращает null (нейтрально) и НЕ вызывает
 * ни одного network probe. all-success / partial / failure сценарии не изменяются.
 */

// Мокаем сами валидаторы площадок, а не обёртку checkPlatform (ESM внутренние вызовы
// не перехватываются через export-spy; валидаторы — честно вызываемая граница сети).
vi.mock('../services/social-api-validator', () => ({
  validateTelegramConnection: vi.fn().mockResolvedValue({ isValid: false, message: 'нетокен' }),
  validateTelegramToken: vi.fn().mockResolvedValue({ isValid: false, message: 'нетокен' }),
  validateVkToken: vi.fn().mockResolvedValue({ isValid: false, message: 'нетокен' }),
  validateInstagramToken: vi.fn().mockResolvedValue({ isValid: false, message: 'нетокен' }),
  validateFacebookToken: vi.fn().mockResolvedValue({ isValid: false, message: 'нетокен' }),
  validateYoutubeApiKey: vi.fn().mockResolvedValue({ isValid: false, message: 'нетокен' }),
}));

describe('SM-46: checkAllPlatforms при 0 настроенных площадок', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('0 площадок => null (нейтрально «проверять нечего»), ни одного network probe', async () => {
    vi.mocked(validateTelegramToken).mockResolvedValue({ isValid: true, message: '' });
    const res = await checkAllPlatforms({}, '2026-08-20T07:00:00.000Z');
    expect(res).toBeNull();
    // Ни один валидатор (сетевой probe) не вызван.
    expect(validateTelegramToken).not.toHaveBeenCalled();
    expect(validateVkToken).not.toHaveBeenCalled();
  });

  it('≥1 площадка / все healthy => прежний success (каждая площадка пробирована)', async () => {
    vi.mocked(validateTelegramToken).mockResolvedValue({ isValid: true, message: '' });
    vi.mocked(validateVkToken).mockResolvedValue({ isValid: true, message: '' });
    const sms = { telegram: { token: 't' }, vk: { token: 'vk' } };
    expect(platformsWithCredentials(sms)).toEqual(['telegram', 'vk']);
    const res = await checkAllPlatforms(sms, '2026-08-20T07:00:00.000Z');
    expect(res).not.toBeNull();
    expect(res!.telegram).toEqual({ at: '2026-08-20T07:00:00.000Z', ok: true });
    expect(res!.vk).toEqual({ at: '2026-08-20T07:00:00.000Z', ok: true });
    expect(validateTelegramToken).toHaveBeenCalledTimes(1);
    expect(validateVkToken).toHaveBeenCalledTimes(1);
  });

  it('одна failure => прежний failure (reason сохраняется, успех не врёт)', async () => {
    vi.mocked(validateTelegramToken).mockResolvedValue({ isValid: true, message: '' });
    vi.mocked(validateVkToken).mockResolvedValue({ isValid: false, message: 'Бот выгнан из канала' });
    const sms = { telegram: { token: 't' }, vk: { token: 'vk' } };
    const res = await checkAllPlatforms(sms, '2026-08-20T07:00:00.000Z');
    expect(res!.telegram.ok).toBe(true);
    expect(res!.vk).toEqual({ at: '2026-08-20T07:00:00.000Z', ok: false, reason: 'Бот выгнан из канала' });
  });

  it('маршрут /social/check отвечает нейтральным сообщением при null (не success, не transport error)', () => {
    const src = readFileSync(join(__dirname, '../api/validation-routes.ts'), 'utf-8');
    const routeStart = src.indexOf("app.post('/api/campaigns/:campaignId/social/check'");
    expect(routeStart).toBeGreaterThan(0);
    const routeBody = src.slice(routeStart, src.indexOf('Telegram API Token validation', routeStart));
    expect(routeBody).toContain('checks === null');
    expect(routeBody).toContain("'Нет настроенных площадок для проверки'");
    expect(routeBody).toContain('success: false');
    const nullIdx = routeBody.indexOf('checks === null');
    const successIdx = routeBody.indexOf('success: true');
    expect(nullIdx).toBeGreaterThan(-1);
    expect(successIdx).toBeGreaterThan(nullIdx);
  });
});

import { validateTelegramToken, validateVkToken } from '../services/social-api-validator';
