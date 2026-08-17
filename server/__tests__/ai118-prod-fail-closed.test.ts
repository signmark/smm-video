import { describe, expect, it } from 'vitest';

import { resolveFrontendStaticStrategy, type FrontendStaticStrategy } from '../services/frontend-static-strategy';

/**
 * AI-118 (2026-08-17): в production отсутствие собранного фронта (dist/public) должно
 * ОСТАНАВЛИВАТЬ запуск на СТАРТЕ (до server.listen()) — fail-closed, без подъёма vite
 * dev-server на боевом хосте. Поведенческий тест чистой логики (не сканирование текста):
 * вызываем resolveFrontendStaticStrategy напрямую и проверяем РЕЗУЛЬТАТ (throw vs static vs dev-fallback).
 *
 * По @Clause_Dev_Hermi: проверяем поведение, а не формулировку ошибки — от правки текста
 * тест падать не должен. Падение идёт до listen => /health не отвечает => выкатка откатывает.
 */

describe('AI-118: resolveFrontendStaticStrategy — prod fail-closed, vite только для dev', () => {
  it('prod + сборка отсутствует => THROW (запуск остановлен, dev-server не поднимается)', () => {
    expect(() =>
      resolveFrontendStaticStrategy(true, '/srv/app/dist/public', false),
    ).toThrow();
  });

  it('prod + сборка на месте => serve_static, и ТОЛЬКО статика (никакого возврата в dev/fallback)', () => {
    const s: FrontendStaticStrategy = resolveFrontendStaticStrategy(true, '/srv/app/dist/public', true);
    expect(s.kind).toBe('serve_static');
    expect(s.distPath).toBe('/srv/app/dist/public');
  });

  it('dev + сборки нет => разрешён vite dev-server (fallback только для development)', () => {
    const s: FrontendStaticStrategy = resolveFrontendStaticStrategy(false, '/srv/app/dist/public', false);
    expect(s.kind).toBe('dev_vite_fallback');
  });

  it('dev + сборка на месте => serve_static (тоже нормально в dev)', () => {
    const s: FrontendStaticStrategy = resolveFrontendStaticStrategy(false, '/srv/app/dist/public', true);
    expect(s.kind).toBe('serve_static');
  });
});
