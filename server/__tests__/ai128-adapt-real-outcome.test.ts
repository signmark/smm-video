import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { contentAdaptationReadiness } from '../routes/content';

/**
 * AI-128 (2026-08-19): маршрут /api/content/:id/adapt раньше возвращал success:true и
 * «Content adaptation started», даже когда сервис не настроен (N8N_URL / N8N_API_KEY
 * отсутствуют) и никакого исходящего вызова не происходило — человеку врали, что
 * адаптация запущена. Это тот же класс дефекта, что AI-126 (ответ успехом при невыполненной работе).
 *
 * Фикс: contentAdaptationReadiness решает, возможна ли адаптация; маршрут отвечает
 * НЕ-успехом, когда сервис не настроен. Поведенческий тест чистой функции + source-guard,
 * что маршрут вызывает readiness и отвечает от его результата (не безусловным success).
 */

describe('AI-128: contentAdaptationReadiness — реальный исход /adapt', () => {
  it('сервис не настроен (нет N8N_URL/N8N_API_KEY) => canAdapt:false, ответ НЕ успех', () => {
    expect(contentAdaptationReadiness(undefined, undefined).canAdapt).toBe(false);
    expect(contentAdaptationReadiness('', undefined).canAdapt).toBe(false);
    expect(contentAdaptationReadiness(undefined, 'k').canAdapt).toBe(false);
    const ready = contentAdaptationReadiness(undefined, undefined);
    if (!ready.canAdapt) {
      expect(ready.reason).toContain('не настроен'); // дежурный поймёт причину с первой строки
    }
  });

  it('оба значения заданы => canAdapt:true (можно запустить)', () => {
    expect(contentAdaptationReadiness('https://n8n.local', 'key-123').canAdapt).toBe(true);
  });

  it('маршрут отвечает от РЕЗУЛЬТАТА readiness, а не безусловным success:true', () => {
    const src = readFileSync(join(__dirname, '../routes/content.ts'), 'utf-8');
    const routeStart = src.indexOf('app.post("/api/content/:id/adapt"');
    expect(routeStart).toBeGreaterThan(0);
    // Конец маршрута — закрытие `} catch (error) { ... }` и `});` после блока.
    const routeEnd = src.indexOf('Failed to adapt content', routeStart);
    expect(routeEnd).toBeGreaterThan(routeStart);
    const routeBody = src.slice(routeStart, routeEnd);
    // Маршрут вызывает readiness и при canAdapt:false отвечает НЕ-успехом (503 + success:false),
    // и это происходит ДО безусловного res.json({ success: true }).
    expect(routeBody).toContain('contentAdaptationReadiness(n8nUrl, n8nApiKey)');
    expect(routeBody).toContain('if (!readiness.canAdapt)');
    expect(routeBody).toContain('res.status(503).json({ success: false');
    const guardIdx = routeBody.indexOf('if (!readiness.canAdapt)');
    const successIdx = routeBody.indexOf('res.json({ success: true');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(successIdx).toBeGreaterThan(guardIdx);
  });
});
