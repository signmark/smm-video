/**
 * AI-70: проверяем сам приговор, а не запуск npm audit.
 *
 * Смысл этих проверок — не «функция работает», а «список исключений не сможет
 * тихо стать вечным». Три способа обмануть такую проверку: принять находку без
 * объяснения, оставить принятие навсегда и забыть удалить запись о пакете,
 * которого больше нет. Все три закрыты здесь.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideAuditGate,
  parseNpmAuditJson,
  type AuditException,
} from '../../scripts/audit-gate';

const ROOT = join(__dirname, '..', '..');

const полное = (over: Partial<AuditException> = {}): AuditException => ({
  package: 'xlsx',
  severity: 'high',
  why: 'исправления не существует',
  mitigation: 'пакет используется только на запись, чтение запрещено тестом',
  accepted_by: 'владелец',
  accepted_on: '2026-08-17',
  review_by: '2026-11-17',
  ...over,
});

describe('AI-70: что пропускается, а что нет', () => {
  it('находка уровня high без исключения — не пройдено', () => {
    const v = decideAuditGate([{ package: 'lodash', severity: 'high' }], [], '2026-08-17');
    expect(v.ok).toBe(false);
    expect(v.problems[0].kind).toBe('unaccepted');
  });

  it('находка ниже high не блокирует: гейт настроен на high и выше', () => {
    const v = decideAuditGate(
      [
        { package: 'a', severity: 'moderate' },
        { package: 'b', severity: 'low' },
      ],
      [],
      '2026-08-17',
    );
    expect(v.ok).toBe(true);
  });

  it('critical блокирует так же, как high', () => {
    const v = decideAuditGate([{ package: 'z', severity: 'critical' }], [], '2026-08-17');
    expect(v.ok).toBe(false);
  });

  it('находка с действующим исключением — пройдено, и она названа', () => {
    const v = decideAuditGate([{ package: 'xlsx', severity: 'high' }], [полное()], '2026-08-17');
    expect(v.ok).toBe(true);
    expect(v.accepted).toEqual(['xlsx']);
  });
});

describe('AI-70: список исключений не может стать вечным', () => {
  it('просроченное исключение красит гейт', () => {
    const v = decideAuditGate(
      [{ package: 'xlsx', severity: 'high' }],
      [полное({ review_by: '2026-08-16' })],
      '2026-08-17',
    );
    expect(v.ok).toBe(false);
    expect(v.problems[0].kind).toBe('expired');
  });

  it('в день пересмотра исключение ещё действует, на следующий — уже нет', () => {
    const ex = [полное({ review_by: '2026-11-17' })];
    const findings = [{ package: 'xlsx' as const, severity: 'high' as const }];
    expect(decideAuditGate(findings, ex, '2026-11-17').ok).toBe(true);
    expect(decideAuditGate(findings, ex, '2026-11-18').ok).toBe(false);
  });

  it('исключение без объяснения не принимается', () => {
    const v = decideAuditGate(
      [{ package: 'xlsx', severity: 'high' }],
      [полное({ mitigation: '' })],
      '2026-08-17',
    );
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.kind === 'malformed')).toBe(true);
    // И сама находка остаётся непринятой: пустое исключение не закрывает её.
    expect(v.problems.some((p) => p.kind === 'unaccepted')).toBe(true);
  });

  it('устаревшее исключение — пакет починили, а запись осталась — тоже красит', () => {
    const v = decideAuditGate([], [полное()], '2026-08-17');
    expect(v.ok).toBe(false);
    expect(v.problems[0].kind).toBe('stale');
  });
});

describe('AI-70: разбор отчёта npm audit', () => {
  it('вытаскивает имя пакета и уровень', () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        xlsx: { severity: 'high' },
        tar: { severity: 'moderate' },
      },
    });
    expect(parseNpmAuditJson(raw)).toEqual([
      { package: 'xlsx', severity: 'high' },
      { package: 'tar', severity: 'moderate' },
    ]);
  });

  it('чистое дерево — пустой список, а не падение', () => {
    expect(parseNpmAuditJson(JSON.stringify({ vulnerabilities: {} }))).toEqual([]);
    expect(parseNpmAuditJson(JSON.stringify({}))).toEqual([]);
  });
});

describe('AI-70: список исключений в репозитории', () => {
  const config = JSON.parse(
    readFileSync(join(ROOT, 'security-audit-exceptions.json'), 'utf-8'),
  );

  it('каждая запись заполнена целиком', () => {
    for (const ex of config.exceptions) {
      for (const field of ['package', 'severity', 'why', 'mitigation', 'accepted_by', 'accepted_on', 'review_by']) {
        expect(String(ex[field] ?? '').trim(), `${ex.package}: поле ${field}`).not.toBe('');
      }
    }
  });

  it('срок пересмотра не бессрочный: не дальше года от принятия', () => {
    // Год — предел, за которым «пересмотрим потом» перестаёт отличаться от «никогда».
    for (const ex of config.exceptions) {
      const accepted = new Date(ex.accepted_on);
      const review = new Date(ex.review_by);
      const дней = (review.getTime() - accepted.getTime()) / 86_400_000;
      expect(дней, `${ex.package}: срок пересмотра`).toBeGreaterThan(0);
      expect(дней, `${ex.package}: срок пересмотра`).toBeLessThanOrEqual(366);
    }
  });

  it('единственное сегодняшнее исключение — xlsx, и оно ссылается на тест, который его закрывает', () => {
    // Если исключений станет больше, это надо заметить и обсудить, а не пропустить молча.
    expect(config.exceptions.map((e: AuditException) => e.package)).toEqual(['xlsx']);
    expect(config.exceptions[0].mitigation).toContain('xlsx-write-only.test.ts');
  });
});
