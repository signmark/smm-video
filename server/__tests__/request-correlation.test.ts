/**
 * Сквозная корреляция строк лога (AI-65, этап 2 из docs/LOGGING-PLAN.md).
 *
 * Приёмка из плана дословно: «по reqId из ответа находится вся цепочка строк
 * этого запроса». Плюс проверяем, что убранные утечки не вернутся: полный URL
 * с query и тело ответа в строке лога.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REQUEST_ID_HEADER,
  currentRequestId,
  enrichRequestContext,
  generateRequestId,
  getRequestContext,
  routePattern,
  runWithRequestContext,
  sanitizeRequestId,
} from '../utils/request-context';

describe('AI-65: контекст запроса', () => {
  it('reqId виден из вложенного асинхронного кода', async () => {
    // Ради этого и взят AsyncLocalStorage: сервисы на три уровня ниже роутера
    // логируют, не принимая reqId параметром.
    const seen: Array<string | undefined> = [];

    await runWithRequestContext({ reqId: 'abc123' }, async () => {
      seen.push(currentRequestId());
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      seen.push(currentRequestId());
    });

    expect(seen).toEqual(['abc123', 'abc123']);
  });

  it('вне запроса reqId отсутствует, а не выдумывается', () => {
    // Фоновые задачи и старт процесса не должны получать чужой идентификатор.
    expect(currentRequestId()).toBeUndefined();
  });

  it('контексты параллельных запросов не смешиваются', async () => {
    const results = await Promise.all([
      runWithRequestContext({ reqId: 'first' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return currentRequestId();
      }),
      runWithRequestContext({ reqId: 'second' }, async () => {
        return currentRequestId();
      }),
    ]);

    expect(results).toEqual(['first', 'second']);
  });

  it('userId и campaignId доопределяются по ходу запроса', () => {
    runWithRequestContext({ reqId: 'r1' }, () => {
      enrichRequestContext({ userId: 'u1' });
      enrichRequestContext({ campaignId: 'c1' });

      expect(getRequestContext()).toEqual({ reqId: 'r1', userId: 'u1', campaignId: 'c1' });
    });
  });

  it('доопределение вне запроса не падает', () => {
    expect(() => enrichRequestContext({ userId: 'u1' })).not.toThrow();
  });
});

describe('AI-65: чужой x-request-id', () => {
  it('нормальное значение принимается', () => {
    expect(sanitizeRequestId('trace-abc.123_XY')).toBe('trace-abc.123_XY');
  });

  it('мусор отбрасывается — он попадёт в логи', () => {
    // Заголовок приходит снаружи и уезжает в лог, поэтому алфавит ограничен:
    // иначе туда можно положить перевод строки и подделать соседнюю запись.
    expect(sanitizeRequestId('bad value')).toBeNull();
    expect(sanitizeRequestId('inject\nline')).toBeNull();
    expect(sanitizeRequestId('x'.repeat(65))).toBeNull();
    expect(sanitizeRequestId(undefined)).toBeNull();
    expect(sanitizeRequestId(['a'])).toBeNull();
  });

  it('свой идентификатор короткий и стабильной формы', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(generateRequestId()).not.toBe(id);
  });
});

describe('AI-65: шаблон маршрута вместо подставленных id', () => {
  it('UUID сворачивается', () => {
    expect(routePattern('/api/analytics/e6063049-16de-482e-8e90-69a3e3d9b668'))
      .toBe('/api/analytics/:id');
  });

  it('числовой id сворачивается', () => {
    expect(routePattern('/api/campaigns/175959583/posts')).toBe('/api/campaigns/:id/posts');
  });

  it('осмысленные сегменты не трогаются', () => {
    expect(routePattern('/api/health')).toBe('/api/health');
    expect(routePattern('/api/v1/posts')).toBe('/api/v1/posts');
  });
});

describe('AI-65: убранные утечки не вернулись', () => {
  const indexSource = () => readFileSync(join(__dirname, '..', 'index.ts'), 'utf-8');

  it('полный URL с query больше не пишется в лог', () => {
    // Было: console.log(`[HTTP] ${req.method} ${req.originalUrl}`) — мимо
    // логгера, а значит мимо редактирования секретов в query.
    expect(indexSource()).not.toMatch(/\[HTTP\]\s*\$\{req\.method\}\s*\$\{req\.originalUrl\}/);
  });

  it('тело ответа не подмешивается в строку запроса', () => {
    // Было: перехват res.json в переменную и `logLine += JSON.stringify(...)`
    // с обрезкой до 80 символов — начало токена всё равно уезжало в лог.
    //
    // Сверяем КОД, а не текст: первая версия этой проверки искала само слово
    // capturedJsonResponse и падала на комментарии, который объясняет удаление.
    // Сторож, срабатывающий на прозу, даёт ложную тревогу и учит его игнорировать.
    const src = indexSource();

    expect(src).not.toMatch(/capturedJsonResponse\s*=/);
    expect(src).not.toMatch(/res\.json\s*=\s*function/);
  });
});
