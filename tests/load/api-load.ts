#!/usr/bin/env npx ts-node
/**
 * API Load Test — проверяет производительность основных эндпоинтов под нагрузкой.
 *
 * Запуск:
 *   npx ts-node tests/load/api-load.ts
 *
 * Переменные окружения:
 *   BASE_URL      — адрес сервера (обязателен или PLAYWRIGHT_BASE_URL, по умолчанию: http://localhost:5000)
 *   TEST_EMAIL    — email пользователя (обязателен для авторизованных эндпоинтов)
 *   TEST_PASSWORD — пароль (обязателен для авторизованных эндпоинтов)
 *   CONCURRENCY   — число параллельных запросов (по умолчанию: 50)
 *
 * Критерии успеха:
 *   - p95 latency < 2000ms для каждого эндпоинта
 *   - success rate >= 95% для каждого эндпоинта (считаются только 2xx ответы)
 */

import * as dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5000';
const TEST_EMAIL = process.env.TEST_EMAIL || process.env.DIRECTUS_ADMIN_EMAIL || null;
const TEST_PASSWORD = process.env.TEST_PASSWORD || process.env.DIRECTUS_ADMIN_PASSWORD || null;
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '50', 10);
const P95_THRESHOLD_MS = 2000;
const SUCCESS_RATE_THRESHOLD = 0.95;

interface RequestResult {
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  error?: string;
}

interface EndpointReport {
  endpoint: string;
  method: string;
  total: number;
  succeeded: number;
  failed: number;
  successRate: number;
  avgMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  passed: boolean;
  failures: string[];
}

function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(idx, sortedArr.length - 1))];
}

async function fetchWithMetrics(
  url: string,
  options: RequestInit = {}
): Promise<RequestResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - start;
    const ok = res.ok;
    return { ok, statusCode: res.status, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, statusCode: 0, latencyMs, error: message };
  }
}

async function runEndpointLoad(
  label: string,
  method: string,
  url: string,
  options: RequestInit,
  concurrency: number
): Promise<EndpointReport> {
  console.log(`  → Testing ${method} ${label} (${concurrency}x concurrent)...`);

  const batches: Promise<RequestResult>[][] = [];
  for (let i = 0; i < concurrency; i++) {
    batches.push([fetchWithMetrics(url, { method, ...options })]);
  }

  const results = await Promise.all(batches.flat());

  const succeeded = results.filter(r => r.ok).length;
  const failed = results.length - succeeded;
  const successRate = succeeded / results.length;

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const avgMs = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);
  const p50Ms = percentile(latencies, 50);
  const p95Ms = percentile(latencies, 95);
  const p99Ms = percentile(latencies, 99);

  const failures: string[] = [];
  if (p95Ms > P95_THRESHOLD_MS) {
    failures.push(`p95 ${p95Ms}ms > threshold ${P95_THRESHOLD_MS}ms`);
  }
  if (successRate < SUCCESS_RATE_THRESHOLD) {
    failures.push(
      `success rate ${(successRate * 100).toFixed(1)}% < threshold ${SUCCESS_RATE_THRESHOLD * 100}%`
    );
  }

  return {
    endpoint: label,
    method,
    total: results.length,
    succeeded,
    failed,
    successRate,
    avgMs,
    minMs: latencies[0] ?? 0,
    p50Ms,
    p95Ms,
    p99Ms,
    maxMs: latencies[latencies.length - 1] ?? 0,
    passed: failures.length === 0,
    failures,
  };
}

function printReport(reports: EndpointReport[]): void {
  const RESET = '\x1b[0m';
  const GREEN = '\x1b[32m';
  const RED = '\x1b[31m';
  const BOLD = '\x1b[1m';
  const CYAN = '\x1b[36m';
  const YELLOW = '\x1b[33m';

  console.log('\n' + BOLD + '═'.repeat(100) + RESET);
  console.log(BOLD + CYAN + '  API LOAD TEST REPORT' + RESET);
  console.log(BOLD + '═'.repeat(100) + RESET);

  const header = [
    'Endpoint'.padEnd(35),
    'Method'.padEnd(8),
    'Total'.padEnd(7),
    'OK'.padEnd(6),
    'Fail'.padEnd(6),
    'Rate%'.padEnd(7),
    'Avg ms'.padEnd(8),
    'min ms'.padEnd(8),
    'p50 ms'.padEnd(8),
    'p95 ms'.padEnd(8),
    'p99 ms'.padEnd(8),
    'max ms'.padEnd(8),
    'Status',
  ].join('');
  console.log(BOLD + header + RESET);
  console.log('─'.repeat(100));

  for (const r of reports) {
    const status = r.passed ? GREEN + '✅ PASS' + RESET : RED + '❌ FAIL' + RESET;
    const p95Color = r.p95Ms > P95_THRESHOLD_MS ? RED : '';
    const rateColor = r.successRate < SUCCESS_RATE_THRESHOLD ? RED : '';

    const row = [
      r.endpoint.padEnd(35),
      r.method.padEnd(8),
      String(r.total).padEnd(7),
      String(r.succeeded).padEnd(6),
      String(r.failed).padEnd(6),
      (rateColor + (r.successRate * 100).toFixed(1) + RESET).padEnd(rateColor ? 13 : 7),
      String(r.avgMs).padEnd(8),
      String(r.minMs).padEnd(8),
      String(r.p50Ms).padEnd(8),
      (p95Color + String(r.p95Ms) + RESET).padEnd(p95Color ? 16 : 8),
      String(r.p99Ms).padEnd(8),
      String(r.maxMs).padEnd(8),
      status,
    ].join('');
    console.log(row);

    for (const f of r.failures) {
      console.log('  ' + RED + '  ⚠ ' + f + RESET);
    }
  }

  console.log('─'.repeat(100));

  const totalPassed = reports.filter(r => r.passed).length;
  const totalFailed = reports.filter(r => !r.passed).length;
  const overallStatus =
    totalFailed === 0
      ? GREEN + BOLD + `ALL ${totalPassed} ENDPOINTS PASSED` + RESET
      : RED + BOLD + `${totalFailed} ENDPOINT(S) FAILED, ${totalPassed} PASSED` + RESET;

  console.log('  Overall: ' + overallStatus);
  console.log(BOLD + '═'.repeat(100) + RESET + '\n');
}

async function getAuthToken(): Promise<string | null> {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    console.warn(
      '\n⚠  TEST_EMAIL / TEST_PASSWORD env vars are not set.\n' +
      '   Authenticated endpoints (auth/me, campaigns, campaign-content, keywords)\n' +
      '   will be SKIPPED. Set the variables to run the full suite.\n'
    );
    return null;
  }

  console.log(`\nAuthenticating as ${TEST_EMAIL}...`);
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(
        `  ❌ Auth login failed with status ${res.status} — check TEST_EMAIL / TEST_PASSWORD.\n` +
        '  Authenticated endpoints will be SKIPPED.'
      );
      return null;
    }
    interface AuthLoginResponse {
      access_token?: string;
      data?: { access_token?: string };
      token?: string;
      accessToken?: string;
    }
    const data = await res.json() as AuthLoginResponse;
    const token =
      data.access_token ??
      data.data?.access_token ??
      data.token ??
      data.accessToken ??
      null;
    if (token) {
      console.log('  ✅ Auth token obtained');
    } else {
      console.error('  ❌ Auth response did not contain a token — authenticated endpoints will be SKIPPED.');
    }
    return token ?? null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ Auth request error: ${message} — authenticated endpoints will be SKIPPED.`);
    return null;
  }
}

interface CampaignItem {
  id?: string | number;
}

interface CampaignsListResponse {
  data?: CampaignItem[];
}

async function getFirstCampaignId(authHeaders: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/campaigns`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const raw = await res.json() as CampaignItem[] | CampaignsListResponse;
    const list: CampaignItem[] = Array.isArray(raw) ? raw : ((raw as CampaignsListResponse).data ?? []);
    const firstId = list[0]?.id;
    return firstId != null ? String(firstId) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`\nAPI Load Test — target: ${BASE_URL}`);
  console.log(`Concurrency: ${CONCURRENCY} parallel requests per endpoint`);
  console.log(`Thresholds: p95 < ${P95_THRESHOLD_MS}ms, success rate ≥ ${SUCCESS_RATE_THRESHOLD * 100}%\n`);

  const token = await getAuthToken();
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const campaignId = authHeaders.Authorization
    ? await getFirstCampaignId(authHeaders)
    : null;

  if (campaignId) {
    console.log(`  Using campaign ID: ${campaignId}`);
  }

  const endpoints: Array<{
    label: string;
    method: string;
    path: string;
    requiresAuth: boolean;
    requiresCampaign?: boolean;
  }> = [
    { label: '/api/health', method: 'GET', path: '/api/health', requiresAuth: false },
    { label: '/api/auth/me', method: 'GET', path: '/api/auth/me', requiresAuth: true },
    { label: '/api/campaigns', method: 'GET', path: '/api/campaigns', requiresAuth: true },
    {
      label: '/api/campaign-content',
      method: 'GET',
      path: campaignId
        ? `/api/campaign-content?campaignId=${campaignId}`
        : '/api/campaign-content',
      requiresAuth: true,
    },
    {
      label: '/api/keywords',
      method: 'GET',
      path: campaignId
        ? `/api/keywords/${campaignId}`
        : '/api/keywords',
      requiresAuth: true,
      requiresCampaign: true,
    },
  ];

  const reports: EndpointReport[] = [];
  const skippedEndpoints: string[] = [];

  for (const ep of endpoints) {
    if (ep.requiresAuth && !authHeaders.Authorization) {
      const msg = `${ep.label} — skipped (TEST_EMAIL / TEST_PASSWORD not set)`;
      console.log(`  ⚠ Skipping ${msg}`);
      skippedEndpoints.push(ep.label);
      continue;
    }
    if (ep.requiresCampaign && !campaignId) {
      const msg = `${ep.label} — skipped (no campaign found on server)`;
      console.log(`  ⚠ Skipping ${msg}`);
      skippedEndpoints.push(ep.label);
      continue;
    }

    const report = await runEndpointLoad(
      ep.label,
      ep.method,
      `${BASE_URL}${ep.path}`,
      ep.requiresAuth ? { headers: authHeaders } : {},
      CONCURRENCY
    );
    reports.push(report);
  }

  printReport(reports);

  const RED = '\x1b[31m';
  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';

  let hasSkipFailure = false;
  if (skippedEndpoints.length > 0) {
    console.log(
      RED + BOLD +
      `\n  ⚠ SKIPPED ${skippedEndpoints.length} required endpoint(s) — full test suite was NOT validated:\n` +
      RESET +
      skippedEndpoints.map(e => `    • ${e}`).join('\n') +
      '\n  Set TEST_EMAIL and TEST_PASSWORD to run the complete load test.'
    );
    hasSkipFailure = true;
  }

  const anyFailed = reports.some(r => !r.passed) || hasSkipFailure;
  process.exit(anyFailed ? 1 : 0);
}

main().catch(err => {
  console.error('Load test crashed:', err);
  process.exit(1);
});
