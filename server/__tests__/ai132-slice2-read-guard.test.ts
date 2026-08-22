/**
 * AI-132 slice 2: read-side schema guard.
 *
 * Behavioral tests for `guardReadParams` and the `list()` integration. Each
 * test is mutation-proof: removing the validation step from the production
 * path or from the validator function MUST turn at least one test red.
 *
 * Environment is forced to 'test' so the guard throws on unknown fields. In
 * 'production' the same code logs only — that branch is exercised by setting
 * NODE_ENV inline within a single test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loggerSpy, makeLoggerMock } from './helpers/logger-mock';

vi.mock('../utils/logger', () => makeLoggerMock());

// Локальный замоканный axios — модульный мок перекрывает глобальный из setup.ts.
// Объект с функцией-по-умолчанию + всеми нужными методами, чтобы
// `vi.spyOn(axios, 'request')` работал и `axios(config)` тоже.
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
  guardReadParams,
  validateReadParams,
  isKnownCollection,
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

describe('AI-132 slice 2: validateReadParams (filter/sort/fields)', () => {
  it('accepts known fields in filter, sort, and fields', () => {
    const violations = validateReadParams('campaign_content', {
      filter: { status: { _eq: 'draft' }, campaign_id: { _in: ['c1', 'c2'] } },
      sort: ['-created_at', 'title'],
      fields: ['id', 'title', 'status'],
    });
    expect(violations).toEqual([]);
  });

  it('skips operator keys in filter (_and/_or/_eq/_in/_nnull)', () => {
    const violations = validateReadParams('campaign_content', {
      filter: {
        _and: [
          { status: { _eq: 'draft' } },
          { _or: [{ user_id: { _eq: 'u1' } }, { content_type: { _nnull: true } }] },
        ],
      },
    });
    expect(violations).toEqual([]);
  });

  it('skips wildcard forms in fields (*, *.*, rel.*)', () => {
    const violations = validateReadParams('campaign_content', {
      fields: ['*', '*.*', 'campaign_id.*'],
    });
    expect(violations).toEqual([]);
  });

  it('skips aggregate functions (count(*), year(field))', () => {
    const violations = validateReadParams('campaign_content', {
      fields: ['count(*)', 'year(created_at)'],
    });
    expect(violations).toEqual([]);
  });

  it('reports unknown field in filter (mutates: drop check -> red)', () => {
    const violations = validateReadParams('campaign_content', {
      filter: { totally_made_up: { _eq: 'x' } },
    });
    expect(violations).toEqual([{ where: 'filter', value: 'totally_made_up' }]);
  });

  it('reports unknown field in sort (mutates: drop check -> red)', () => {
    const violations = validateReadParams('campaign_content', {
      sort: ['-campain_content_id', 'created_at'], // typo in the middle
    });
    expect(violations).toEqual([{ where: 'sort', value: '-campain_content_id' }]);
  });

  it('reports unknown field in fields list', () => {
    const violations = validateReadParams('campaign_content', {
      fields: ['id', 'imag_url', 'status'], // 'imag_url' should be 'image_url'
    });
    expect(violations).toEqual([{ where: 'fields', value: 'imag_url' }]);
  });

  it('reports multiple violations across filter+sort+fields in one shot', () => {
    const violations = validateReadParams('campaign_content', {
      filter: { bogus_a: 'x', status: { _eq: 'draft' }, bogus_b: 'y' },
      sort: ['-bogus_sort'],
      fields: ['id', 'bogus_field'],
    });
    expect(violations).toHaveLength(4);
    const seen = new Set(violations.map((v) => `${v.where}:${v.value}`));
    expect(seen.has('filter:bogus_a')).toBe(true);
    expect(seen.has('filter:bogus_b')).toBe(true);
    expect(seen.has('sort:-bogus_sort')).toBe(true);
    expect(seen.has('fields:bogus_field')).toBe(true);
  });

  it('validates deep — first segment must exist on parent collection', () => {
    const violations = validateReadParams('campaign_content', {
      deep: {
        // campaign_id exists; bogus_rel does not.
        campaign_id: { _filter: { status: { _eq: 'active' } } },
        bogus_rel: { fields: ['id'] },
      },
    });
    // campaign_id._filter is a nested filter — the inner 'status' check is
    // done against the union fallback (see file), so no violation there.
    // bogus_rel is unknown at parent level — reported.
    expect(violations).toEqual([{ where: 'deep', value: 'bogus_rel' }]);
  });
});

describe('AI-132 slice 2: guardReadParams mode split', () => {
  it('test mode: throws with details on unknown field', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      expect(() =>
        guardReadParams('campaign_content', { filter: { typo_field: 'x' } }),
      ).toThrow(/Directus schema guard \(read\)/);
      expect(loggerSpy.error).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it('production mode: logs [schema-guard] error, does not throw', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() =>
        guardReadParams('campaign_content', { filter: { typo_field: 'x' } }),
      ).not.toThrow();
      expect(loggerSpy.error).toHaveBeenCalledTimes(1);
      const msg = loggerSpy.error.mock.calls[0][0];
      expect(msg).toMatch(/\[schema-guard\]/);
      expect(msg).toMatch(/typo_field/);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });
});

describe('AI-132 slice 2: isKnownCollection + unknown-collection error', () => {
  it('recognises a real collection', () => {
    expect(isKnownCollection('campaign_content')).toBe(true);
  });

  it('rejects a non-existent collection', () => {
    expect(isKnownCollection('campain_content_typo')).toBe(false);
  });

  it('DirectusUnknownCollectionError carries collection name and sample', () => {
    const err = new DirectusUnknownCollectionError('campain_content', [
      'campaign_content',
      'campaign_keywords',
    ]);
    expect(err.name).toBe('DirectusUnknownCollectionError');
    expect(err.collection).toBe('campain_content');
    expect(err.message).toMatch(/campain_content/);
    expect(err.message).toMatch(/campaign_content/);
  });
});

describe('AI-132 slice 2: list() integration', () => {
  it('list() на известной коллекции с известными полями — не бросает на guard', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.DIRECTUS_URL = 'https://directus.test';
    try {
      requestMock.mockResolvedValueOnce({ data: { data: [] } });
      const { DirectusCrud } = await import('../services/directus-crud');
      const crud = new DirectusCrud();
      const result = await crud.list<{ id: string }>('campaign_content', {
        authToken: 'test',
        filter: { status: { _eq: 'draft' } },
        fields: ['id', 'title'],
        sort: ['-created_at'],
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
      expect(requestMock).toHaveBeenCalledTimes(1);
      const cfg = requestMock.mock.calls[0][0];
      expect(cfg.params).toBeDefined();
      expect(cfg.params.filter).toEqual({ status: { _eq: 'draft' } });
      expect(cfg.params.fields).toEqual(['id', 'title']);
      expect(cfg.params.sort).toEqual(['-created_at']);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
      delete process.env.DIRECTUS_URL;
    }
  });

  it('list() на 403 для несуществующей коллекции — бросает DirectusUnknownCollectionError (mutation: drop the branch -> red)', async () => {
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
        await crud.list('campain_content_typo', { authToken: 'test' });
      } catch (e: any) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DirectusUnknownCollectionError);
      expect(caught.message).toMatch(/campain_content_typo/);
      expect(caught.collection).toBe('campain_content_typo');
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
      delete process.env.DIRECTUS_URL;
    }
  });

  it('list() на 403 для ИЗВЕСТНОЙ коллекции — пробрасывает axios-ошибку как раньше', async () => {
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
        await crud.list('campaign_content', { authToken: 'test' });
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

  it('list() с опечаткой в поле filter — бросает guard в test mode (mutation: drop guardReadParams call -> red)', async () => {
    // Это ключевой интеграционный тест: проверяет, что list() ВЫЗЫВАЕТ
    // guardReadParams и что ошибка из стpожа пробрасывается наружу.
    // Если убрать вызов guardReadParams в list(), этот тест краснеет.
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.DIRECTUS_URL = 'https://directus.test';
    try {
      // Запрос не дойдёт до axios — guard бросит раньше.
      const { DirectusCrud } = await import('../services/directus-crud');
      const crud = new DirectusCrud();
      let caught: any = null;
      try {
        await crud.list('campaign_content', {
          authToken: 'test',
          filter: { totally_made_up_field: 'x' },
        });
      } catch (e: any) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toMatch(/Directus schema guard \(read\)/);
      expect(caught.message).toMatch(/totally_made_up_field/);
      // axios не вызывался — guard сработал до запроса.
      expect(requestMock).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
      delete process.env.DIRECTUS_URL;
    }
  });
});
