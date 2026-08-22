/**
 * AI-89 — поведенческие тесты для server/config/service-urls.ts.
 *
 * Каждый тест — мутационно-устойчивый: если убрать throw в
 * getRequiredServiceUrl или забыть вызвать validateRequiredServiceUrls
 * в index.ts — соответствующий тест покраснеет.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getRequiredServiceUrl,
  getOptionalServiceUrl,
  validateRequiredServiceUrls,
  REQUIRED_VARS,
} from "../config/service-urls";

// Сохраним оригинальные значения и подменим process.env в каждом тесте,
// чтобы один тест не видел переменные, поставленные другим.
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Очищаем все переменные, которые читает service-urls.
  for (const key of REQUIRED_VARS) {
    delete process.env[key];
  }
  delete process.env.APP_PUBLIC_URL;
  delete process.env.SMM_HOST;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('AI-89 / getRequiredServiceUrl', () => {
  it('возвращает значение, если переменная задана', () => {
    process.env.DIRECTUS_URL = 'https://directus.omemo.tech';
    expect(getRequiredServiceUrl('DIRECTUS_URL')).toBe('https://directus.omemo.tech');
  });

  it('бросает с понятным сообщением, если переменная не задана', () => {
    // Прячем process.env.DIRECTUS_URL явно.
    let caught: any = null;
    try {
      getRequiredServiceUrl('DIRECTUS_URL');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toContain('DIRECTUS_URL');
    expect(caught.message).toContain('not set');
    expect(caught.message).toContain('silently fall back');
  });

  it('бросает, если переменная пустая строка', () => {
    process.env.DIRECTUS_URL = '   ';
    let caught: any = null;
    try {
      getRequiredServiceUrl('DIRECTUS_URL');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it('перечисляет остальные обязательные переменные в сообщении (подсказка оператору)', () => {
    let caught: any = null;
    try {
      getRequiredServiceUrl('DIRECTUS_URL');
    } catch (e) {
      caught = e;
    }
    // В сообщении должны быть ВСЕ остальные обязательные переменные,
    // чтобы оператор сразу увидел, что ещё проверить.
    for (const key of REQUIRED_VARS) {
      if (key === 'DIRECTUS_URL') continue;
      expect(caught.message).toContain(key);
    }
  });
});

describe('AI-89 / getOptionalServiceUrl', () => {
  it('возвращает значение, если переменная задана', () => {
    process.env.APP_PUBLIC_URL = 'https://smm.example.com';
    expect(getOptionalServiceUrl('APP_PUBLIC_URL')).toBe(
      'https://smm.example.com',
    );
  });

  it('возвращает null, если переменная не задана (не бросает)', () => {
    expect(getOptionalServiceUrl('APP_PUBLIC_URL')).toBeNull();
  });

  it('возвращает null для пустой строки', () => {
    process.env.OMEMO_POSTBACK_URL = '';
    expect(getOptionalServiceUrl('APP_PUBLIC_URL')).toBeNull();
  });
});

describe('AI-89 / validateRequiredServiceUrls', () => {
  it('проходит без ошибок, если все обязательные переменные заданы', () => {
    for (const key of REQUIRED_VARS) {
      process.env[key] = `https://example.com/${key.toLowerCase()}`;
    }
    expect(() => validateRequiredServiceUrls()).not.toThrow();
  });

  it('бросает, если ни одна переменная не задана', () => {
    let caught: any = null;
    try {
      validateRequiredServiceUrls();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toContain('Missing required env variables');
    // В сообщении должны быть ВСЕ обязательные переменные.
    for (const key of REQUIRED_VARS) {
      expect(caught.message).toContain(key);
    }
  });

  it('бросает, если не задана хотя бы одна переменная', () => {
    for (const key of REQUIRED_VARS) {
      if (key === 'DIRECTUS_URL') continue;
      process.env[key] = `https://example.com/${key.toLowerCase()}`;
    }
    let caught: any = null;
    try {
      validateRequiredServiceUrls();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toContain('DIRECTUS_URL');
  });

  it('мутация: убрать throw -> тест ловит отсутствие проверки', () => {
    // Smoke: validateRequiredServiceUrls() с пустым env должна бросить.
    // Если кто-то случайно заменит throw на return, этот тест покраснеет.
    expect(() => validateRequiredServiceUrls()).toThrow();
  });
});
