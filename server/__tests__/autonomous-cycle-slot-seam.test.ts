import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { materializeCycleSlot } from '../services/autonomous-ai';

/**
 * SM-20 Phase 2 (A) — binding real-caller seam proof (per @Codex_PM option (a)).
 *
 * materializeCycleSlot is the narrow typed seam local to Phase-5 orchestration:
 *  - missing preallocatedId -> returns lost_reservation and NEVER invokes the
 *    callback (which encloses the entire model->campaign_content block);
 *  - present id -> invokes the callback exactly once with that id, returns its
 *    result as materialized.
 *
 * Executable proof + AST/source-boundary guard that the real Phase-5 loop calls
 * the seam with cycleSlots.get(i) and that the old direct-fallthrough is absent.
 */

describe('SM-20 Phase A: materializeCycleSlot seam', () => {
  it('loser (undefined id): callback не вызван — 0 model, 0 create; результат lost_reservation', async () => {
    let modelCalls = 0;
    let createCalls = 0;
    const result = await materializeCycleSlot(undefined, async () => {
      modelCalls++;
      createCalls++;
      return { success: true, posts: [] };
    });
    expect(result).toEqual({ tag: 'lost_reservation' });
    expect(modelCalls).toBe(0);
    expect(createCalls).toBe(0);
  });

  it('winner (id present): callback вызван ровно один раз, точный id передан, результат materialized', async () => {
    let modelCalls = 0;
    let createCalls = 0;
    let seenId: string | undefined;
    const result = await materializeCycleSlot('content-win', async (id) => {
      seenId = id;
      modelCalls++;
      createCalls++;
      return { success: true, posts: [{ id: 'c-win', content: 'x' }] };
    });
    expect(result.tag).toBe('materialized');
    expect(modelCalls).toBe(1);
    expect(createCalls).toBe(1);
    expect(seenId).toBe('content-win');
  });

  // ЧЕСТНО: это сканер исходника, а не поведение. Он стережёт ОДНО свойство,
  // которое поведенческим тестом не поймать без всего стека генерации: в цикле
  // нельзя подставить выдуманный идентификатор вместо удержанного слота.
  // Всё остальное про выбор слотов проверяется по результату в
  // sm20-b-pause-behavior.test.ts и sm20-b4-recovery-behavior.test.ts.
  it('сканер: Phase-5 loop берёт идентификатор ТОЛЬКО из удержанного слота, без запасного варианта', () => {
    const src = readFileSync(join(__dirname, '../services/autonomous-ai.ts'), 'utf-8');
    // Call-site: `materializeCycleSlot(preallocatedId, async (` (не определение функции).
    const callIdx = src.indexOf('materializeCycleSlot(preallocatedId, async');
    expect(callIdx).toBeGreaterThan(0);
    const preallocIdx = src.lastIndexOf('const preallocatedId = slot.contentId', callIdx);
    expect(preallocIdx).toBeGreaterThan(0);
    const loopWindow = src.slice(preallocIdx, src.indexOf('// ФАЗА 5.5'));
    expect(loopWindow).toContain('const preallocatedId = slot.contentId');
    // B3 binding guard: строгое присваивание БЕЗ ?? / || fallback (например
    // `?? randomUUID()` обязан краснеть).
    const preallocLine = loopWindow.split('\n').find((l) => l.includes('const preallocatedId = slot.contentId')) || '';
    expect(preallocLine.includes('??')).toBe(false);
    expect(preallocLine.includes('||')).toBe(false);
    expect(preallocLine.trim()).toContain('slot.contentId');
    expect(loopWindow).toContain('materializeCycleSlot(preallocatedId, async');
    // Лосер-ветка: seam возвращает lost_reservation, loop делает continue до createContent.
    expect(loopWindow).toContain("slotResult.tag === 'lost_reservation'");
    const contIdx = loopWindow.indexOf("slotResult.tag === 'lost_reservation'");
    expect(loopWindow.indexOf('continue', contIdx)).toBeGreaterThan(contIdx);
  });
});
