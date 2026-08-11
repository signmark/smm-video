/**
 * Фолбек на DeepSeek при отказе Gemini.
 *
 * ПОЧЕМУ. 11.08 владелец получил в интерфейсе сырую ошибку Gemini
 * `401 ACCESS_TOKEN_TYPE_UNSUPPORTED` — приложение держало в памяти устаревший
 * ключ. Фолбек на DeepSeek в коде был, но включался только по списку «квотных»
 * ошибок: 429, 503, quota, rate limit. Ошибка авторизации в список не входила,
 * исключение уходило наверх, и запасной движок с валидным ключом не пробовался.
 *
 * Пользователю всё равно, кончилась квота или протух ключ: текст не появился.
 * Поэтому правило перевёрнуто — пробуем DeepSeek при любом отказе Gemini, кроме
 * двух случаев, где виноват сам запрос и смена движка ничего не даст.
 *
 * Тест держит именно это правило, а не список кодов: перечисление кодов уже
 * один раз оказалось неполным, и повторять его в тесте — значит закрепить
 * ту же ошибку.
 */
import { describe, expect, it } from 'vitest';
import { shouldFallbackToDeepSeek } from '../services/ai-service';

const err = (message: string) => new Error(message);

describe('shouldFallbackToDeepSeek', () => {
  it('пробует DeepSeek при отказе авторизации — тот самый случай 11.08', () => {
    expect(
      shouldFallbackToDeepSeek(
        err('HTTP error 401: {"error":{"code":401,"status":"UNAUTHENTICATED",' +
          '"details":[{"reason":"ACCESS_TOKEN_TYPE_UNSUPPORTED"}]}}'),
      ),
    ).toBe(true);
  });

  it('пробует DeepSeek, когда регион не поддерживается', () => {
    // Прямой запрос к Google из России: 400 FAILED_PRECONDITION.
    // Формально 400, но запрос корректен — виноват не он.
    expect(
      shouldFallbackToDeepSeek(err('HTTP error 400: User location is not supported for the API use. FAILED_PRECONDITION')),
    ).toBe(true);
  });

  it.each([
    ['квота', 'HTTP error 429: RESOURCE_EXHAUSTED quota exceeded'],
    ['перегрузка', 'HTTP error 503: UNAVAILABLE, model is overloaded'],
    ['таймаут сети', 'network timeout at https://generativelanguage.googleapis.com'],
    ['403 от прокси', 'HTTP error 403: error code: 1010'],
    ['пустая ошибка', ''],
  ])('пробует DeepSeek: %s', (_name, message) => {
    expect(shouldFallbackToDeepSeek(err(message))).toBe(true);
  });

  it('НЕ пробует DeepSeek, если неверен сам запрос', () => {
    // Другой движок ответит так же — фолбек только сожжёт лимит и время.
    expect(
      shouldFallbackToDeepSeek(err('HTTP error 400: {"error":{"status":"INVALID_ARGUMENT"}}')),
    ).toBe(false);
  });

  it('НЕ пробует DeepSeek, если сработали фильтры содержимого', () => {
    // Это не сбой движка, а решение по содержимому. Обходить его подстановкой
    // другой модели нельзя — иначе фильтр перестаёт что-либо значить.
    expect(shouldFallbackToDeepSeek(err('Candidate was blocked due to SAFETY'))).toBe(false);
    expect(shouldFallbackToDeepSeek(err('finishReason: PROHIBITED_CONTENT'))).toBe(false);
  });

  it('не падает на ошибке без message', () => {
    expect(shouldFallbackToDeepSeek(undefined)).toBe(true);
    expect(shouldFallbackToDeepSeek({})).toBe(true);
  });
});
