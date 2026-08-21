import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { emitPublishScheduled, emitCronStarted } from '../utils/logger';

/**
 * AI-65 срез B2 (task #65): события publish.scheduled и cron.started эмитятся через
 * ЕДИНЫЕ точки emitPublishScheduled / emitCronStarted. publish.scheduled отвечает на
 * «когда публикация поставлена в расписание» — основной случай из ВСЕХ точек постановки
 * (пользователь); поле `kind` отличает его от «остался в расписании после неудачной попытки».
 * cron.started — живость планировщика. Наблюдение не должно уметь ронять систему: обе точки
 * переживают любую ошибку внутри журналирования.
 */

const P = (p: string) => readFileSync(join(__dirname, p), 'utf-8');

describe('AI-65 срез B2: publish.scheduled / cron.started через единые точки', () => {
  it('emitPublishScheduled — единая точка с машинным ключом publish.scheduled и различающим kind', () => {
    const s = P('../utils/logger.ts');
    const idx = s.indexOf('export function emitPublishScheduled(');
    expect(idx).toBeGreaterThan(0);
    const block = s.slice(idx, s.indexOf('export function flushLogs', idx));
    expect(block).toContain("logEvent('publish.scheduled'");
    expect(block).toContain("kind: opts.kind ?? 'initially_scheduled'");
    expect(block).toContain("'rescheduled_after_failure'");
    expect(block).toContain("'info'");
    expect(block).toContain("'publish'");
  });

  it('emitCronStarted — единая точка с машинным ключом cron.started', () => {
    const s = P('../utils/logger.ts');
    const idx = s.indexOf('export function emitCronStarted(');
    expect(idx).toBeGreaterThan(0);
    const block = s.slice(idx, idx + 300);
    expect(block).toContain("logEvent('cron.started'");
    expect(block).toContain("'scheduler'");
  });

  it('все ШЕСТЬ точек постановки публикации (пользователь) вызывают emitPublishScheduled', () => {
    const files = [
      ['../api/publishing-routes.ts', 3],
      ['../api/social-publishing-router.ts', 2],
      ['../routes/stories.ts', 1],
    ] as const;
    for (const [f, expected] of files) {
      const s = P(f);
      expect(s).toContain('emitPublishScheduled');
      expect((s.match(/emitPublishScheduled\(/g) || []).length).toBe(expected);
    }
    // В API-маршрутах kind — первоначальная постановка (пользователь).
    for (const f of ['../api/publishing-routes.ts', '../api/social-publishing-router.ts', '../routes/stories.ts']) {
      expect(P(f)).toContain("kind: 'initially_scheduled'");
    }
  });

  it('планировщик: cron.started через emitCronStarted; перенос после неудачи — kind rescheduled_after_failure', () => {
    const s = P('../services/publish-scheduler.ts');
    expect(s).toContain('emitCronStarted(this.tickCount)');
    expect(s).toContain("kind: 'rescheduled_after_failure'");
    const guardIdx = s.indexOf("if (finalContentStatus === 'scheduled')");
    const emitIdx = s.indexOf("emitPublishScheduled(String(content.id)", guardIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(emitIdx).toBeGreaterThan(guardIdx);
  });
});

describe('AI-65 срез B2: наблюдение не должно уметь ронять систему', () => {
  it('emitPublishScheduled и emitCronStarted оборачивают logEvent в try/catch — ошибка журналирования не роняет проход', () => {
    const s = P('../utils/logger.ts');
    const a = s.indexOf('export function emitPublishScheduled(');
    const b = s.indexOf('export function emitCronStarted(');
    // Обе функции содержат try { logEvent... } catch { }.
    const aBlock = s.slice(a, b);
    expect(aBlock).toMatch(/try \{/);
    expect(aBlock).toMatch(/catch \{/);
    expect(aBlock).toContain("logEvent('publish.scheduled'");
    const bBlock = s.slice(b, b + 240);
    expect(bBlock).toMatch(/try \{/);
    expect(bBlock).toMatch(/catch \{/);
    expect(bBlock).toContain("logEvent('cron.started'");
    // Явный комментарий — принцип «наблюдение не должно уметь ломать систему».
    expect(aBlock).toContain('Наблюдение не должно уметь ронять систему');
  });
});
