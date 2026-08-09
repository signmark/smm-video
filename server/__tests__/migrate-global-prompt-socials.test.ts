import { describe, it, expect, vi } from 'vitest';

// The script runs main() at module top-level, so we mock axios fully.
// Use vi.hoisted so the references are available inside the mock factory.
const H = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue({ data: { data: [] } }),
  patch: vi.fn().mockResolvedValue({ data: {} }),
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => '{"candidates":[]}'),
  writeFileSync: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    get: H.get,
    patch: H.patch,
    create: vi.fn(() => ({ get: H.get, patch: H.patch })),
  },
}));

vi.mock('node:fs', () => ({
  existsSync: H.existsSync,
  readFileSync: H.readFileSync,
  writeFileSync: H.writeFileSync,
}));

import { shouldApplyLegacyMigration, applyReviewedCandidate } from '../../scripts/maintenance/migrate-global-prompt-socials';

describe('migration apply (SM-18 rev @Codex_HM)', () => {
  it('TOCTOU: НЕ применяет, если текущее значение отличается от просмотренного before', () => {
    // dry-run увидел "…пользователи Facebook", владелец одобрил.
    const reviewedBefore = 'Ты — SMM-менеджер. Аудитория — пользователи Facebook.';
    // Между dry-run и apply пользователь вручную отредактировал промт.
    const currentPrompt = 'Ты — SMM-менеджер. Аудитория — пользователи Facebook и Telegram (изменено вручную).';
    expect(shouldApplyLegacyMigration(currentPrompt, reviewedBefore)).toBe(false);
  });

  it('TOCTOU: применяет, если текущее значение байт-в-байт совпадает с reviewed before', () => {
    const reviewedBefore = 'Ты — SMM-менеджер. Аудитория — пользователи Facebook.';
    expect(shouldApplyLegacyMigration(reviewedBefore, reviewedBefore)).toBe(true);
  });

  it('TOCTOU: НЕ применяет, если промт изменили полностью (rewrite собственника)', () => {
    const reviewedBefore = 'После миграции: пиши для [socialNetworks]';
    const currentPrompt = 'Полностью мой собственный промт — не трогать';
    expect(shouldApplyLegacyMigration(currentPrompt, reviewedBefore)).toBe(false);
  });

  it('TOCTOU: НЕ применяет, если поле отсутствует (стало нестроковым/удалено после dry-run)', () => {
    const reviewedBefore = 'Ты — SMM-менеджер. Аудитория — пользователи Facebook.';
    // Удалённое/нестроковое поле (undefined) НЕ должно ложно совпасть.
    expect(shouldApplyLegacyMigration(undefined, reviewedBefore)).toBe(false);
    expect(shouldApplyLegacyMigration(null, reviewedBefore)).toBe(false);
    expect(shouldApplyLegacyMigration(42, reviewedBefore)).toBe(false);
  });
});

describe('applyReviewedCandidate (скрипт apply-path, integration)', () => {
  const reviewed = {
    id: 'camp-1',
    before: 'Ты — SMM-менеджер. Аудитория — пользователи Facebook.',
    after: 'Ты — SMM-менеджер. Аудитория — пользователи [socialNetworks].',
    fieldKey: 'globalPrompt',
  };

  beforeEach(() => {
    H.patch.mockClear();
  });

  it('совпавшая запись → один PATCH именно reviewed.after', async () => {
    H.get.mockResolvedValueOnce({
      data: { data: { id: 'camp-1', autonomous_settings: JSON.stringify({ globalPrompt: reviewed.before }) } },
    });
    const outcome = await applyReviewedCandidate(reviewed);
    expect(outcome).toBe('applied');
    expect(H.patch).toHaveBeenCalledTimes(1);
    // Patch payload содержит reviewed.after (не пересчитанный).
    const body = H.patch.mock.calls[0][1] as { autonomous_settings: string };
    const decoded = JSON.parse(body.autonomous_settings);
    expect(decoded.globalPrompt).toBe(reviewed.after);
  });

  it('поле изменено после dry-run → 0 PATCH (TOCTOU)', async () => {
    H.get.mockResolvedValueOnce({
      data: { data: { id: 'camp-1', autonomous_settings: JSON.stringify({ globalPrompt: 'Изменено вручную после dry-run' }) } },
    });
    const outcome = await applyReviewedCandidate(reviewed);
    expect(outcome).toBe('skip');
    expect(H.patch).not.toHaveBeenCalled();
  });

  it('поле удалено после dry-run (не строка) → 0 PATCH', async () => {
    H.get.mockResolvedValueOnce({
      data: { data: { id: 'camp-1', autonomous_settings: JSON.stringify({ otherField: 1 }) } },
    });
    const outcome = await applyReviewedCandidate(reviewed);
    expect(outcome).toBe('skip');
    expect(H.patch).not.toHaveBeenCalled();
  });
});
