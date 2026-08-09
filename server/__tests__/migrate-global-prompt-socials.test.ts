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

import { shouldApplyLegacyMigration } from '../../scripts/maintenance/migrate-global-prompt-socials';

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
});
