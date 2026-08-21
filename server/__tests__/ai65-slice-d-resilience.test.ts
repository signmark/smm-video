/**
 * AI-65 срез D v3 (task #73 follow-up): обёртка исходящих вызовов Telegram
 * не должна ронять публикацию, если журналирование падает, И должна
 * различать HTTP-успех (axios не бросил) и бизнес-успех (тело ok:true).
 *
 * Telegram API возвращает HTTP 200 даже при ошибке:
 *   - чат не найден → {"ok": false, "description": "chat not found"}
 *   - бот выкинут из канала → {"ok": false, "description": "Forbidden"}
 *   - сообщение слишком длинное → {"ok": false, "description": "..."}
 * Без проверки `data.ok` журнал писал бы `status: 'ok'` для провалившейся
 * публикации.
 *
 * ЗАЧЕМ: фильтры в журнале по system=telegram должны различать успешные
 * вызовы и провалы, иначе операционная картина врёт.
 *
 * Тесты:
 *   1. Падающее журналирование не роняет вызов (ok-ветка + error-ветка axios).
 *   2. Бизнес-успех (HTTP 200, ok:true) → status:'ok', reason отсутствует.
 *   3. Бизнес-провал (HTTP 200, ok:false) → status:'error', reason:'api_error'.
 *   4. mutation: снять проверку ok → тест (3) краснеет.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мок logger.ts: log должен быть ВЫЗЫВАЕМОЙ функцией с методами,
// как в проде. Иначе сторож logger-mock-completeness считает мок
// неполным и красит тест соседа.
//
// Каждый мок-метод бросает ИСКЛЮЧЕНИЕ — это проверка устойчивости обёртки.
vi.mock('../utils/logger', () => {
  const throwingExternal = vi.fn(() => {
    throw new Error('журналирование упало');
  });
  const logFn: any = vi.fn(() => {
    throw new Error('журналирование упало');
  });
  logFn.info = vi.fn();
  logFn.warn = vi.fn();
  logFn.error = vi.fn();
  logFn.debug = vi.fn();
  logFn.external = throwingExternal;
  return {
    log: logFn,
    default: logFn,
    classifyExternalError: vi.fn(() => 'error'),
  };
});

import { trackTelegramCall } from '../services/social-platforms/telegram-http';
import { log } from '../utils/logger';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AI-65 slice D: trackTelegramCall устойчив к падающему журналированию', () => {
  it('ok-ветка + HTTP ok:true: даже если log.external бросает, fn() выполняется и результат возвращается', async () => {
    const fakeAxios = vi.fn(async () => ({
      data: { ok: true, result: { message_id: 42 } },
    }));

    const result = await trackTelegramCall('sendMessage', () => fakeAxios());

    expect(fakeAxios).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { ok: true, result: { message_id: 42 } } });
    expect(log.external).toHaveBeenCalledTimes(1);
  });

  it('error-ветка + axios бросает: обёртка пробрасывает ту же ошибку', async () => {
    const axiosErr = Object.assign(new Error('Network Error'), { code: 'ECONNRESET' });
    const fakeAxios = vi.fn(async () => {
      throw axiosErr;
    });

    await expect(
      trackTelegramCall('sendMessage', () => fakeAxios())
    ).rejects.toBe(axiosErr);
    expect(fakeAxios).toHaveBeenCalledTimes(1);
    // log.external вызывается в error-ветке перед throw.
    expect(log.external).toHaveBeenCalledTimes(1);
  });

  it('ok:true → log.external получает status: "ok"', async () => {
    const fakeAxios = vi.fn(async () => ({
      data: { ok: true, result: { message_id: 1 } },
    }));

    await trackTelegramCall('sendMessage', () => fakeAxios());

    expect(log.external).toHaveBeenCalledTimes(1);
    expect(log.external).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'telegram',
        operation: 'sendMessage',
        status: 'ok',
      })
    );
    const call = (log.external as any).mock.calls[0][0];
    expect(call.reason).toBeUndefined();
  });

  it('ok:false (HTTP 200, бизнес-провал) → log.external получает status: "error", reason: "api_error"', async () => {
    const fakeAxios = vi.fn(async () => ({
      data: { ok: false, description: 'chat not found' },
    }));

    const result = await trackTelegramCall('sendMessage', () => fakeAxios());

    expect(result).toEqual({ data: { ok: false, description: 'chat not found' } });
    expect(log.external).toHaveBeenCalledTimes(1);
    expect(log.external).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'telegram',
        operation: 'sendMessage',
        status: 'error',
        reason: 'api_error',
      })
    );
  });

  it('mutation: снять проверку isTelegramApiError → этот тест краснеет', async () => {
    // Сам факт того, что этот тест проходит, означает: обёртка при ok:false
    // реально отправляет в log.external status:'error' (а не 'ok' как было
    // до правки). Если снять проверку isTelegramApiError, тест «ok:false»
    // краснеет — журнал начнёт писать 'ok' для провалившейся публикации.
    const fakeAxios = vi.fn(async () => ({
      data: { ok: false, description: 'Forbidden' },
    }));

    await trackTelegramCall('sendMessage', () => fakeAxios());

    expect(log.external).toHaveBeenCalledTimes(1);
    const call = (log.external as any).mock.calls[0][0];
    expect(call.status).toBe('error');
    expect(call.reason).toBe('api_error');
  });
});