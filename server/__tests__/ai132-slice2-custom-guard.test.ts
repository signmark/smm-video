/**
 * AI-132 slice 2 (custom): schema guard for `DirectusCrud.custom()`.
 *
 * Behavioral tests for `custom()` against the read guard. Mirrors the slice
 * list() tests in structure but covers the new shapes:
 *  — `/items/{collection}` paths go through the same schema guard as list();
 *  — service paths (`/users/me`, `/files`, ...) are NOT validated;
 *  — the same 403-on-unknown-collection disambiguation applies.
 *
 * Each test is mutation-proof: removing the guard or the 403 branch in
 * custom() MUST turn at least one test red.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loggerSpy, makeLoggerMock } from './helpers/logger-mock';

vi.mock('../utils/logger', () => makeLoggerMock());

// Local axios mock — callable with a `request` method, mirroring slice-list.
const requestMock = vi.fn();
const axiosMockObj: any = vi.fn((cfg: any) => requestMock(cfg));
axiosMockObj.request = requestMock;
axiosMockObj.get = vi.fn();
axiosMockObj.post = vi.fn();
axiosMockObj.patch = vi.fn();
axiosMockObj.delete = vi.fn();
axiosMockObj.create = vi.fn(() => axiosMockObj);
axiosMockObj.interceptors = { request: { use: vi.fn(), eject: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } };
axiosMockObj.defaults = { headers: { common: {} } };
axiosMockObj.isAxiosError = (e: any) => !!e?.isAxiosError;
vi.mock('axios', () => ({ default: axiosMockObj, ...axiosMockObj }));

import axios from 'axios';
import {
  DirectusUnknownCollectionError,
} from '../services/directus-schema-guard';

beforeEach(() => {
  loggerSpy.error.mockClear();
  loggerSpy.warn.mockClear();
  loggerSpy.info.mockClear();
  loggerSpy.debug.mockClear();
  requestMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI-132 slice 2: custom() guards /items/{collection} paths', () => {
  it('GET /items/campaign_content с известными полями — guard не бросает', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.DIRECTUS_URL = 'https://directus.test';
    try {
      requestMock.mockResolvedValueOnce({ data: { data: [] } });
      const { DirectusCrud } = await import('../services/directus-crud');
      const crud = new DirectusCrud();
      const result = await crud.custom<{ id: string }>(
        'get',
        '/items/campaign_content',
        { filter: { status: { _eq: 'draft' } }, fields: ['id', 'title'] },
        { authToken: 'test' },
      );
      expect(Array.isArray(result)).toBe(true);
      expect(requestMock).toHaveBeenCalledTimes(1);
      const cfg = requestMock.mock.calls[0][0];
      expect(cfg.params.filter).toEqual({ status: { _eq: 'draft' } });
      expect(cfg.params.fields).toEqual(['id', 'title']);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
      delete process.env.DIRECTUS_URL;
    }
  });

  it('GET /items/campaign_content с опечаткой в filter — guard бросает ДО axios (mutation: drop guard call in custom() -> red)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.DIRECTUS_URL = 'https://directus.test';
    try {
      const { DirectusCrud } = await import('../services/directus-crud');
      const crud = new DirectusCrud();
      let caught: any = null;
      try {
        await crud.custom(
          'get',
          '/items/campaign_content',
          { filter: { totally_made_up: 'x' } },
          { authToken: 'test' },
        );
      } catch (e: any) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toMatch(/Directus schema guard \(read\)/);
      expect(requestMock).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
      delete process.env.DIRECTUS_URL;
    }
  });

  it('GET /items/campain_content_typo (несуществующая) на 403 → DirectusUnknownCollectionError', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.DIRECTUS_URL = 'https://directus.test';
    try {
      requestMock.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 403, data: { errors: [{ code: 'FORBIDDEN' }] } },
      });
      const { DirectusCrud } = await import('../services/directus-crud');
      const crud = new DirectusCrud();
      let caught: any = null;
      try {
        await crud.custom('get', '/items/campain_content_typo', undefined, {
          authToken: 'test',
        });
      } catch (e: any) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DirectusUnknownCollectionError);
      expect(caught.collection).toBe('campain_content_typo');
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
      delete process.env.DIRECTUS_URL;
    }
  });

  it('GET /items/campaign_content (существующая) на 403 — axios-ошибка пробрасывается как раньше', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.DIRECTUS_URL = 'https://directus.test';
    try {
      requestMock.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 403, data: { errors: [{ code: 'FORBIDDEN' }] } },
      });
      const { DirectusCrud } = await import('../services/directus-crud');
      const crud = new DirectusCrud();
      let caught: any = null;
      try {
        await crud.custom('get', '/items/campaign_content', undefined, {
          authToken: 'test',
        });
      } catch (e: any) {
        caught = e;
      }
      expect(caught).not.toBeInstanceOf(DirectusUnknownCollectionError);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
      delete process.env.DIRECTUS_URL;
    }
  });
});

describe('AI-132 slice 2: custom() does NOT validate service paths', () => {
  // Service paths (e.g. /users/me, /auth/refresh, /files) are not /items/{collection}.
  // The guard must skip them: validating them would either throw on legitimate
  // service endpoints or wrap service responses in collection-shaped errors.
  // Mutation "always run guard on custom()" would turn this red.

  const servicePaths: Array<[string, string]> = [
    ['get', '/users/me'],
    ['get', '/auth/refresh'],
    ['get', '/files'],
    ['get', '/server/info'],
    ['get', '/settings'],
    ['post', '/auth/login'],
  ];

  for (const [method, path] of servicePaths) {
    it(`${method.toUpperCase()} ${path} — guard НЕ валидируется`, async () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      process.env.DIRECTUS_URL = 'https://directus.test';
      try {
        requestMock.mockResolvedValueOnce({ data: { data: null } });
        const { DirectusCrud } = await import('../services/directus-crud');
        const crud = new DirectusCrud();
        // Даже с «полевыми» данными в data (для GET идёт в params),
        // которые НЕ прошли бы guard для /items/{collection}, вызов
        // должен дойти до axios без выброса — это сервисный путь.
        await crud.custom(method, path, { made_up_field: 'x' }, { authToken: 'test' });
        expect(requestMock).toHaveBeenCalledTimes(1);
        expect(loggerSpy.error).not.toHaveBeenCalled();
      } finally {
        if (prev === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prev;
        delete process.env.DIRECTUS_URL;
      }
    });
  }

  it('POST /items/campaign_content — guard НЕ валидируется (writes have their own guard)', async () => {
    // AI-132 slice 1 already covers writes. The read-side guard is only
    // meaningful for GET. If someone wires it to POST, the slice-1 guardWriteData
    // is still in place and this read-side guard would false-positive on
    // relational paths the schema snapshot can't represent.
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.DIRECTUS_URL = 'https://directus.test';
    try {
      requestMock.mockResolvedValueOnce({ data: { data: { id: 'x' } } });
      const { DirectusCrud } = await import('../services/directus-crud');
      const crud = new DirectusCrud();
      // В data — write payload, не params. Защитник должен игнорировать.
      await crud.custom(
        'post',
        '/items/campaign_content',
        { totally_made_up_payload_field: 'x' },
        { authToken: 'test' },
      );
      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(loggerSpy.error).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
      delete process.env.DIRECTUS_URL;
    }
  });
});

describe('AI-132 slice 2: custom() guard вызывается ОДИН РАЗ даже при ретраях', () => {
  it('GET /items/campaign_content с опечаткой на 503 → 200: loggerSpy.error == 1', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.DIRECTUS_URL = 'https://directus.test';
    try {
      requestMock
        .mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
        .mockResolvedValueOnce({ data: { data: [] } });
      const { DirectusCrud } = await import('../services/directus-crud');
      const crud = new DirectusCrud();
      loggerSpy.error.mockClear();
      await crud.custom(
        'get',
        '/items/campaign_content',
        { filter: { typo_field: 'x' } },
        { authToken: 'test' },
      );
      expect(loggerSpy.error).toHaveBeenCalledTimes(1);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
      delete process.env.DIRECTUS_URL;
    }
  });
});
