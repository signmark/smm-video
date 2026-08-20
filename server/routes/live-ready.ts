/**
 * AI-41: обработчик готовности `/ready`.
 *
 * Живость `/live` отдельного кода не имеет — она намеренно смонтирована тем же
 * обработчиком, что и `/health` (см. `server/index.ts`), чтобы два ответа не
 * разъехались со временем. Здесь только готовность: опрос обязательных
 * зависимостей и приговор.
 *
 * Ответ наружу не содержит ни адресов, ни имён бакетов, ни текстов ошибок —
 * только имя зависимости, приговор и стабильный код причины. Ручка публичная,
 * поэтому всё, что попадает в неё, считается опубликованным.
 */
import type { Request, Response } from 'express';
import axios from 'axios';
import { directusCrud } from '../services/directus-crud';
import { getPublishScheduler } from '../services/publish-scheduler';
import { classifySchedulerLiveness } from '../services/scheduler-liveness';
import {
  classifyStorageOutcome,
  decideReadiness,
  type DependencyProbe,
} from './readiness';

/** Предел ожидания одной зависимости. Ручка готовности обязана отвечать
 *  быстрее, чем истечёт терпение монитора, даже когда зависимость висит. */
const PROBE_TIMEOUT_MS = 3000;

async function probeDirectus(): Promise<DependencyProbe> {
  const started = Date.now();
  try {
    await directusCrud.list('user_campaigns', { limit: 1, useAdminToken: true });
    return { name: 'directus', required: true, status: 'up', duration_ms: Date.now() - started };
  } catch {
    // Текст ошибки Directus сюда не попадает: он содержит адрес и параметры запроса.
    return {
      name: 'directus',
      required: true,
      status: 'down',
      reason: 'unreachable',
      duration_ms: Date.now() - started,
    };
  }
}

async function probeStorage(): Promise<DependencyProbe> {
  const started = Date.now();
  const bucket = process.env.BEGET_S3_BUCKET;
  if (!bucket) {
    // Хранилище не настроено — это ошибка конфигурации, а не сбой связи,
    // и она обязана быть видна снаружи, а не молча считаться исправной.
    return {
      name: 'storage',
      required: true,
      status: 'down',
      reason: 'rejected',
      duration_ms: Date.now() - started,
    };
  }
  const url = `https://${bucket}.s3.ru1.storage.beget.cloud`;
  let outcome: { httpStatus?: number; errorCode?: string };
  try {
    const res = await axios.head(url, { timeout: PROBE_TIMEOUT_MS });
    outcome = { httpStatus: res.status };
  } catch (err: any) {
    // Ответ с кодом 403/404 приходит через ветку ошибки axios, но означает,
    // что хранилище живо и отвечает. Поломка — только отсутствие ответа.
    outcome = { httpStatus: err?.response?.status, errorCode: err?.code };
  }
  const verdict = classifyStorageOutcome(outcome);
  return {
    name: 'storage',
    required: true,
    status: verdict.status,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
    duration_ms: Date.now() - started,
  };
}

export async function readyHandler(_req: Request, res: Response) {
  // Зависимости опрашиваются одновременно: последовательный опрос сложил бы
  // задержки и ручка отвечала бы дольше, чем ждёт монитор.
  const probes = await Promise.all([probeDirectus(), probeStorage()]);
  const verdict = decideReadiness(probes);

  // SM-45: признак жизни планировщика (machine-readable, по времени). Порог
  // 2 интервала цикла (30s) — при 3 пропавших проходах подряд уже stale.
  const snapshot = getPublishScheduler().getLivenessSnapshot();
  const liveness = classifySchedulerLiveness({
    lastSuccessfulPassAt: snapshot.lastSuccessfulPassAt,
    startedAt: snapshot.startedAt,
    now: Date.now(),
    staleThresholdMs: 2 * 30_000,
    startupGraceMs: 90_000,
  });

  res.status(verdict.httpStatus).json({
    status: verdict.ready ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    dependencies: verdict.dependencies,
    scheduler: {
      status: liveness.status,
      ...(liveness.ageMs !== null ? { ageMs: liveness.ageMs } : {}),
      uptimeMs: liveness.uptimeMs,
    },
  });
}
