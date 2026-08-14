#!/usr/bin/env node
/**
 * Проверка свежести запасных адресов Telegram (task #73, option в).
 *
 * Использование:
 *   TELEGRAM_API_IPS=149.154.167.220,149.154.166.110 node scripts/telegram-fallback-freshness.mjs
 *
 * Выводит по каждому адресу статус fresh/stale и причину; exit 0, если хотя бы
 * один адрес жив; exit 1, если ни один не ответил или переменная не задана.
 * Пин в /etc/hosts не трогает — только читает переменную и зондирует.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Серверный модуль — TypeScript. Для запуска скрипта без tsc-сборки делаем
// минимальный инлайн-зонд, идентичный probeTelegramIp (SNI + rejectUnauthorized).
import * as tls from 'node:tls';

const SNI = 'api.telegram.org';
const PORT = 443;
const TIMEOUT_MS = 5000;

function probe(ip) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok, detail) => { if (!settled) { settled = true; resolve({ ok, detail }); } };
    const s = tls.connect({ host: ip, port: PORT, servername: SNI, rejectUnauthorized: true });
    const t = setTimeout(() => { finish(false, `timeout ${TIMEOUT_MS}ms`); s.destroy(); }, TIMEOUT_MS);
    s.once('secureConnect', () => { clearTimeout(t); finish(true, 'TLS ok'); s.destroy(); });
    s.once('error', (e) => { clearTimeout(t); finish(false, e?.code || e?.message || 'TLS error'); s.destroy(); });
  });
}

const raw = (process.env.TELEGRAM_API_IPS || '').trim();
if (!raw) {
  console.error('TELEGRAM_API_IPS не задана — нечего проверять.');
  process.exit(1);
}

const ips = raw.split(',').map((s) => s.trim()).filter(Boolean);
let fresh = 0;
for (const ip of ips) {
  const { ok, detail } = await probe(ip);
  console.log(`${ip}  ${ok ? 'fresh' : 'STALE'}  ${detail}`);
  if (ok) fresh++;
}
console.log('');
console.log(`fresh: ${fresh}/${ips.length}`);
process.exit(fresh > 0 ? 0 : 1);
