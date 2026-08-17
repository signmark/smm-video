#!/usr/bin/env tsx
/**
 * AI-70: запуск блокирующей проверки уязвимостей.
 *
 * Тонкая обёртка: сам приговор живёт в scripts/audit-gate.ts и покрыт тестами.
 * Здесь только ввод-вывод — запустить npm audit, прочитать список исключений,
 * напечатать отчёт и вернуть код возврата.
 *
 * Почему не `npm audit --audit-level=high` напрямую: он не умеет принимать
 * находку, для которой исправления не существует, и поэтому в блокирующем виде
 * нежизнеспособен — его отключат в первый же день. Ровно это и случилось с
 * шагом из AI-42: он до сих пор отчётный.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideAuditGate, parseNpmAuditJson, formatVerdict } from './audit-gate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let raw: string;
try {
  // npm audit возвращает ненулевой код при наличии находок — это нормальный
  // рабочий случай, а не сбой. Отчёт лежит в stdout в обоих случаях.
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (err: any) {
  raw = err?.stdout;
  if (!raw) {
    console.error('Не удалось получить отчёт npm audit:', err?.message);
    process.exit(2);
  }
}

const findings = parseNpmAuditJson(raw);
const config = JSON.parse(readFileSync(join(ROOT, 'security-audit-exceptions.json'), 'utf-8'));
const today = new Date().toISOString().slice(0, 10);

const verdict = decideAuditGate(findings, config.exceptions ?? [], today);
console.log(formatVerdict(verdict, config.exceptions ?? []));
process.exit(verdict.ok ? 0 : 1);
