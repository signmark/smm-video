import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SM-20 Phase 2 (A) B4 — crash-safe resume, no identity regeneration.
 *
 * The recovery point (per approved contract, #SMM_Work:e65f576f) is the start of
 * runAutonomousCycle, when a restored session already carries an in-progress
 * cycleId + phase. Load cycle rows via ledger getCycleItems, reconcile/materialize
 * BEFORE allocating any NEW cycleId. Removing the recovery call MUST red; reordering
 * it after the new cycleId MUST red (else we resume a fresh cycle and orphan/lose
 * the interrupted one's reservation rows).
 *
 * These are source-boundary guards matching the reviewer's mandatory mutation
 * set: "снос recovery-вызова" and "реюз нового cycleId при resume".
 */

function src(): string {
  return readFileSync(join(__dirname, '../services/autonomous-ai.ts'), 'utf-8');
}

describe('SM-20 Phase A B4: crash-safe resume (no identity regeneration)', () => {
  it('recoverInterruptedCycle вызывается ДО аллокации нового cycleId в runAutonomousCycle', () => {
    const s = src();
    const fnIdx = s.indexOf('async function runAutonomousCycle(state: AutonomousState)');
    expect(fnIdx).toBeGreaterThan(0);
    // Берём тело runAutonomousCycle до первой ФАЗЫ, где уже идёт резервирование.
    const bodyEnd = s.indexOf('// Резервируем ВСЕ слоты цикла', fnIdx);
    expect(bodyEnd).toBeGreaterThan(fnIdx);
    const head = s.slice(fnIdx, bodyEnd);

    // Recovery call присутствует в голове цикла.
    const recIdx = head.indexOf('await recoverInterruptedCycle(state)');
    expect(recIdx).toBeGreaterThan(0);

    // Новый cycleId аллоцируется ПОСЛЕ recovery (не до) — удалить/переставить
    // recovery вызов = красный.
    const allocIdx = head.indexOf('state.cycleId = randomUUID()');
    expect(allocIdx).toBeGreaterThan(recIdx);

    // runId аллоцируется только через guard (if !state.runId), и ДО recovery.
    const runIdGuardIdx = head.indexOf('if (!state.runId) state.runId = randomUUID()');
    expect(runIdGuardIdx).toBeGreaterThan(0);
    expect(runIdGuardIdx).toBeLessThan(recIdx);
    // После recovery нет регенерации runId (позиция recovery позже guard-аллокации).
    expect(recIdx).toBeGreaterThan(runIdGuardIdx);
  });

  it('recoverInterruptedCycle работает через getCycleItems по восстановленным run/cycle и reconcile reserved (immutable ownership из строк)', () => {
    const s = src();
    const defIdx = s.indexOf('async function recoverInterruptedCycle(state: AutonomousState)');
    expect(defIdx).toBeGreaterThan(0);
    const bodyEnd = s.indexOf('}\n\nasync function runAutonomousCycle', defIdx);
    const body = s.slice(defIdx, bodyEnd);

    // Детект по state.cycleId из БД (restored identity), не по новому.
    expect(body).toContain('if (!state.runId || !state.cycleId) return;');
    // Загрузка строк ledgera по восстановленным run/cycle.
    expect(body).toContain('getCycleItems(state.runId, state.cycleId)');
    // reconcile через reconcileAndFill (create-before-filled: content_missing остаётся reserved).
    expect(body).toContain('reconcileAndFill(ref)');
    // Immutable ownership берётся из сессии/строк, а не перегенерируется.
    expect(body).toContain('campaignId: state.campaignId');
    expect(body).toContain('userId: state.userId');
  });

  it('health probe awaited перед первым использованием ledger (B1, не fire-and-forget)', () => {
    const s = src();
    const fnIdx = s.indexOf('async function runAutonomousCycle(state: AutonomousState)');
    const bodyEnd = s.indexOf('// Резервируем ВСЕ слоты цикла', fnIdx);
    const head = s.slice(fnIdx, bodyEnd);
    // awaited (а не fire-and-forget): вызов обёрнут в const healthy + throw при false.
    expect(head).toContain('const healthy = await autonomousCycleLedger.probeCollectionHealth()');
    expect(head).toContain('if (!healthy)');
    expect(head).toContain('throw');
  });
});
