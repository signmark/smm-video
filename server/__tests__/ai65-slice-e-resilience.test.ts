/**
 * AI-65 срез E (task #74): обёртка исходящих вызовов к соцсетям
 * (VK, TikTok, Instagram, Facebook, Threads, YouTube) не должна
 * ронять публикацию, если журналирование падает. И должна различать
 * HTTP-успех (axios не бросил) и бизнес-успех (тело ok:true).
 *
 * ЗАЧЕМ: фильтры в журнале по system=telegram/vk/tiktok/etc. должны
 * работать на машиночитаемых терминах, одинаковых для всех платформ.
 * Падающее журналирование не должно ронять публикацию (как в срезах C, D).
 *
 * Тесты:
 *  - ok-ветка (HTTP 200, тело не содержит error): status: 'ok'.
 *  - error-ветка (axios бросил): обёртка пробрасывает ту же ошибку.
 *  - api_error-ветка (HTTP 200 + body.error): status: 'error', reason: 'api_error'.
 *  - Падающее журналирование: вызов не роняется.
 *  - Без детектора (Facebook/Threads/YouTube): HTTP 200 → status: 'ok', независимо от тела.
 *  - Mutation: снять детектор → тест (api_error) краснеет.
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

import {
  trackExternalCall,
  isVkApiError,
  isTiktokApiError,
  isInstagramReelsApiError,
} from '../utils/external-call';
import { log } from '../utils/logger';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AI-65 slice E: trackExternalCall устойчив к падающему журналированию', () => {
  it('ok-ветка + падающее журналирование: fn() выполняется, результат возвращается', async () => {
    const fakeAxios = vi.fn(async () => ({
      data: { result: { message_id: 42 } },
    }));
    const result = await trackExternalCall('vk', 'wall.post', () => fakeAxios());
    expect(fakeAxios).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { result: { message_id: 42 } } });
    // log.external бросил, но обёртка его поймала.
  });

  it('error-ветка + axios бросает: обёртка пробрасывает ту же ошибку', async () => {
    const axiosErr = Object.assign(new Error('Network Error'), { code: 'ECONNRESET' });
    const fakeAxios = vi.fn(async () => {
      throw axiosErr;
    });
    await expect(
      trackExternalCall('vk', 'wall.post', () => fakeAxios())
    ).rejects.toBe(axiosErr);
    expect(fakeAxios).toHaveBeenCalledTimes(1);
  });

  it('ok-ветка без детектора: log.external получает status: "ok"', async () => {
    const fakeAxios = vi.fn(async () => ({ data: { id: '123' } }));
    await trackExternalCall('facebook', 'feed.post', () => fakeAxios());
    expect(log.external).toHaveBeenCalledTimes(1);
    expect(log.external).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'facebook', operation: 'feed.post', status: 'ok' })
    );
    const call = (log.external as any).mock.calls[0][0];
    expect(call.reason).toBeUndefined();
  });

  it('api_error-ветка VK (HTTP 200, data.error): log.external получает status: "error", reason: "api_error"', async () => {
    const fakeAxios = vi.fn(async () => ({
      data: { error: { error_code: 5, error_msg: 'User authorization failed' } },
    }));
    const result = await trackExternalCall('vk', 'wall.post', () => fakeAxios(), {
      isApiError: isVkApiError,
    });
    expect(result).toEqual({
      data: { error: { error_code: 5, error_msg: 'User authorization failed' } },
    });
    expect(log.external).toHaveBeenCalledTimes(1);
    expect(log.external).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'vk', operation: 'wall.post', status: 'error', reason: 'api_error' })
    );
  });

  it('api_error-ветка TikTok (HTTP 200, data.error.code !== "ok"): log.external получает status: "error"', async () => {
    const fakeAxios = vi.fn(async () => ({
      data: { error: { code: 'invalid_token', message: 'Token expired' } },
    }));
    await trackExternalCall('tiktok', 'video.upload', () => fakeAxios(), {
      isApiError: isTiktokApiError,
    });
    expect(log.external).toHaveBeenCalledTimes(1);
    expect(log.external).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'tiktok', status: 'error', reason: 'api_error' })
    );
  });

  it('api_error-ветка Instagram Reels (HTTP 200, data.error.message): log.external получает status: "error"', async () => {
    const fakeAxios = vi.fn(async () => ({
      data: { error: { message: 'Container not ready' } },
    }));
    await trackExternalCall('instagram', 'media.publish', () => fakeAxios(), {
      isApiError: isInstagramReelsApiError,
    });
    expect(log.external).toHaveBeenCalledTimes(1);
    expect(log.external).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'instagram', status: 'error', reason: 'api_error' })
    );
  });

  it('mutation: снять isApiError → api_error тест краснеет', async () => {
    // Сам факт того, что этот тест проходит, означает: обёртка при data.error
    // реально отправляет в log.external status:'error' (а не 'ok' как было
    // до правки). Если снять проверку isVkApiError, тест (api_error VK)
    // краснеет — журнал начнёт писать 'ok' для провалившейся публикации.
    const fakeAxios = vi.fn(async () => ({
      data: { error: { error_code: 5, error_msg: 'Forbidden' } },
    }));
    await trackExternalCall('vk', 'wall.post', () => fakeAxios(), {
      isApiError: isVkApiError,
    });
    expect(log.external).toHaveBeenCalledTimes(1);
    const call = (log.external as any).mock.calls[0][0];
    expect(call.status).toBe('error');
    expect(call.reason).toBe('api_error');
  });

  it('mutation: убрать try/catch вокруг log.external в ok-ветке → этот тест краснеет', async () => {
    // Если убрать внутренний try/catch вокруг log.external в ok-ветке,
    // падающее журналирование пробросит исключение, и обёртка не вернёт
    // результат. Этот тест гарантирует устойчивость обёртки.
    const fakeAxios = vi.fn(async () => ({ data: { id: '1' } }));
    const result = await trackExternalCall('facebook', 'feed.post', () => fakeAxios());
    expect(result).toEqual({ data: { id: '1' } });
    expect(fakeAxios).toHaveBeenCalledTimes(1);
  });
});