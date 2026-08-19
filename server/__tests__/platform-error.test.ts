/**
 * Смысл проверок: причина отказа площадки не должна теряться. Пустая строка в
 * журнале и общая фраза в карточке оставляют человека без ответа на вопрос
 * «почему мой пост не ушёл» — и разработчика тоже.
 */
import { describe, it, expect } from 'vitest';
import { describePlatformError } from '../services/social-platforms/platform-error';

const CTX = { platform: 'Instagram', step: 'создание контейнера Reels', opId: 'ig_direct_123' };

describe('текст отказа площадки', () => {
  it('обычный текст площадки берётся как есть', () => {
    const err = { response: { status: 400, data: { error: { message: '(#100) Неверный параметр' } } } };
    expect(describePlatformError(err, CTX)).toBe('(#100) Неверный параметр');
  });

  it('отказ без текста не превращается в пустоту', () => {
    // Ровно случай 19.08: площадка ответила ошибкой, message в ней нет.
    const err = { response: { status: 400, data: { error: { type: 'OAuthException', code: 190 } } } };
    const out = describePlatformError(err, CTX);
    expect(out).not.toBe('');
    expect(out).toContain('без объяснения');
    expect(out).toContain('создание контейнера Reels');
    expect(out).toContain('400');
    expect(out).toContain('OAuthException');
    expect(out).toContain('190');
    expect(out).toContain('ig_direct_123');
  });

  it('совсем пустая ошибка всё равно даёт понятную строку', () => {
    const out = describePlatformError({}, { platform: 'Instagram' });
    expect(out).toBe('Instagram отказал без объяснения');
  });

  it('ошибка с пустым message не считается объяснением', () => {
    const err = { message: '   ', response: { status: 500, data: { error: { message: '' } } } };
    const out = describePlatformError(err, CTX);
    expect(out).toContain('без объяснения');
    expect(out).toContain('500');
  });

  it('человеческие поля Meta предпочтительнее технического молчания', () => {
    const err = {
      response: {
        status: 400,
        data: { error: { error_user_title: 'Нет прав', error_user_msg: 'Нужен токен страницы' } },
      },
    };
    expect(describePlatformError(err, CTX)).toBe('Нет прав: Нужен токен страницы');
  });

  it('ошибка строкой тоже читается', () => {
    const err = { response: { status: 502, data: { error: 'Bad Gateway' } } };
    expect(describePlatformError(err, CTX)).toBe('Bad Gateway');
  });

  it('обрыв связи объясняется кодом соединения, а не пустотой', () => {
    const err = { code: 'ECONNRESET', message: '' };
    const out = describePlatformError(err, CTX);
    expect(out).toContain('ECONNRESET');
    expect(out).toContain('без объяснения');
  });

  it('текст исключения используется, когда ответа площадки нет', () => {
    expect(describePlatformError(new Error('Instagram не вернул container id'), CTX))
      .toBe('Instagram не вернул container id');
  });
});
