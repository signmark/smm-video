import { describe, it, expect } from 'vitest';
import { classifyVkError, isVkAuthExpired } from '../services/vk-error-classifier';

/**
 * Все четыре кода ниже сняты с живых токенов кампаний 29.07.2026 в течение
 * одной минуты — вместе с точными текстами VK. До классификатора каждый из них
 * приезжал в UI одинаковым красным тостом с сырым английским текстом.
 */
const REAL_VK_RESPONSES = {
  internalError: {
    error: { error_code: 10, error_msg: 'Internal server error: could not check access_token now, check later.' },
  },
  deadToken: {
    error: { error_code: 5, error_msg: 'User authorization failed: invalid access_token (4).' },
  },
  appBlocked: {
    error: { error_code: 8, error_msg: 'Invalid request: Application is blocked' },
  },
  accessDenied: {
    error: { error_code: 15, error_msg: 'Access denied: token required' },
  },
};

describe('classifyVkError', () => {
  describe('реальные ответы VK', () => {
    it('код 10 — временный сбой платформы: жёлтым и повторить', () => {
      const v = classifyVkError(REAL_VK_RESPONSES.internalError);
      expect(v.kind).toBe('transient');
      expect(v.severity).toBe('warning');
      expect(v.retryable).toBe(true);
      expect(v.code).toBe(10);
    });

    it('код 5 — мёртвый токен: красным, переподключение', () => {
      const v = classifyVkError(REAL_VK_RESPONSES.deadToken);
      expect(v.kind).toBe('auth_expired');
      expect(v.severity).toBe('error');
      expect(v.retryable).toBe(false);
    });

    it('код 8 «Application is blocked» — блокировка приложения, не токена', () => {
      const v = classifyVkError(REAL_VK_RESPONSES.appBlocked);
      expect(v.kind).toBe('app_blocked');
      expect(v.severity).toBe('error');
      // Ждать бесполезно — само не пройдёт.
      expect(v.retryable).toBe(false);
      // Но переподключение помогает: интеграция идёт через needanapp, и новый
      // токен выпишет его приложение. Код 8 в этом проекте означает наследство —
      // токен, выданный ДО перехода на needanapp заблокированным приложением.
      expect(v.userMessage).toContain('Переподключите');
    });

    it('код 15 — отказ в доступе, но токен жив', () => {
      const v = classifyVkError(REAL_VK_RESPONSES.accessDenied);
      expect(v.kind).toBe('access_denied');
    });
  });

  describe('временные коды', () => {
    it.each([
      [1, 'Unknown error occurred'],
      [6, 'Too many requests per second'],
      [9, 'Flood control'],
      [10, 'Internal server error'],
    ])('код %i → transient/warning', (code, msg) => {
      const v = classifyVkError({ error: { error_code: code, error_msg: msg } });
      expect(v.kind).toBe('transient');
      expect(v.severity).toBe('warning');
      expect(v.retryable).toBe(true);
    });
  });

  describe('коды мёртвых учётных данных', () => {
    it.each([5, 27, 28])('код %i → auth_expired', (code) => {
      expect(classifyVkError({ error: { error_code: code, error_msg: 'authorization failed' } }).kind)
        .toBe('auth_expired');
    });
  });

  it('код 8 без «Application is blocked» — это просто кривой запрос', () => {
    const v = classifyVkError({ error: { error_code: 8, error_msg: 'Invalid request' } });
    expect(v.kind).toBe('invalid_params');
  });

  it('код 100 (кривой group_id) → invalid_params, не смерть токена', () => {
    const v = classifyVkError({
      error: { error_code: 100, error_msg: 'One of the parameters specified was missing or invalid: group_id should be greater than 0' },
    });
    expect(v.kind).toBe('invalid_params');
    expect(v.severity).toBe('error');
  });

  it('код 14 — капча: ждать, а не чинить', () => {
    const v = classifyVkError({ error: { error_code: 14, error_msg: 'Captcha needed' } });
    expect(v.kind).toBe('captcha');
    expect(v.severity).toBe('warning');
    expect(v.retryable).toBe(true);
  });

  describe('транспортные сбои', () => {
    it('таймаут axios → transient', () => {
      const v = classifyVkError({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' });
      expect(v.kind).toBe('transient');
      expect(v.retryable).toBe(true);
    });

    it.each([500, 502, 503, 429])('HTTP %i от VK → transient', (status) => {
      expect(classifyVkError({ response: { status } }).kind).toBe('transient');
    });

    it('HTTP 400 транзиентом не считается', () => {
      expect(classifyVkError({ response: { status: 400 } }).kind).toBe('unknown');
    });
  });

  it('нераспознанный код → unknown/error, а не молчаливый успех', () => {
    const v = classifyVkError({ error: { error_code: 9999, error_msg: 'Нечто новое' } });
    expect(v.kind).toBe('unknown');
    expect(v.severity).toBe('error');
    expect(v.code).toBe(9999);
  });

  it('пустой вход не роняет классификатор', () => {
    for (const input of [null, undefined, '', 0, {}, []]) {
      expect(classifyVkError(input).kind).toBe('unknown');
    }
  });

  it('сырой текст VK в userMessage не протекает', () => {
    const v = classifyVkError(REAL_VK_RESPONSES.internalError);
    expect(v.userMessage).not.toContain('Internal server error');
    expect(v.userMessage).toMatch(/[а-яА-Я]/);
  });
});

/**
 * isVkAuthExpired — единственное основание выставить кампании authExpired.
 * Флаг шлёт владельцу письмо и выключает кампанию из refresh cron, поэтому
 * граница здесь узкая намеренно.
 */
describe('isVkAuthExpired', () => {
  it('мёртвый токен → true', () => {
    expect(isVkAuthExpired(REAL_VK_RESPONSES.deadToken)).toBe(true);
  });

  it.each([
    ['временный сбой VK', REAL_VK_RESPONSES.internalError],
    ['заблокированное приложение', REAL_VK_RESPONSES.appBlocked],
    ['отказ в доступе', REAL_VK_RESPONSES.accessDenied],
  ])('%s → false', (_name, details) => {
    expect(isVkAuthExpired(details)).toBe(false);
  });

  it('провал проверки группы при живом users.get → false', () => {
    expect(isVkAuthExpired({
      user: { id: 42 },
      groupError: { error: { error_code: 5, error_msg: 'User authorization failed' } },
    })).toBe(false);
  });

  it('сеть/таймаут (пустой details) → false', () => {
    expect(isVkAuthExpired(undefined)).toBe(false);
    expect(isVkAuthExpired({})).toBe(false);
  });
});
