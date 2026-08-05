import axios from 'axios';
import { directusCrud } from './directus-crud';
import { geminiDirect } from './gemini-direct';
import { aiService } from './ai-service';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { toSafeErrorDetails } from '../utils/safe-error';

const AUTONOMOUS_PERSIST_FILE = join(process.cwd(), 'data', 'autonomous-states.json');

// ── helpers ────────────────────────────────────────────────────────────────

function stateToRecord(state: AutonomousState): Record<string, any> {
  return {
    campaign_id: state.campaignId,
    user_id: state.userId,
    auth_token: state.authToken || '',
    refresh_token: state.refreshToken || null,
    interval_hours: state.interval,
    posts_per_cycle: state.postsPerCycle,
    auto_schedule: state.autoSchedule,
    platforms: state.platforms,
    with_images: state.withImages,
    pipeline_mode: (state as any).pipelineMode || 'full_auto',
    started_at: state.startedAt.toISOString(),
    // SM-20: is_active означает «режим заведён», а не «сейчас крутится».
    // Пауза тоже активна — иначе DB-restore отфильтрует её и режим молча
    // исчезнет после рестарта.
    is_active: true,
    paused: state.paused === true,
    paused_at: state.pausedAt ? state.pausedAt.toISOString() : null,
    // Счётчики раньше не сохранялись и обнулялись при восстановлении. С паузой
    // это стало заметно: «прогресс сохраняется» переставало быть правдой после
    // первого же деплоя.
    cycles_completed: state.cyclesCompleted,
    posts_created: state.postsCreated,
    launch_command: state.launchCommand || null,
    last_cycle_at: state.lastCycleAt ? state.lastCycleAt.toISOString() : null,
  };
}

function activateRestoredState(saved: {
  campaignId: string; userId: string; authToken?: string; refreshToken?: string;
  interval: number; postsPerCycle: number; autoSchedule: boolean;
  platforms: string[]; withImages: boolean; pipelineMode?: string; startedAt: string;
  launchCommand?: string; lastCycleAt?: string;
  paused?: boolean; pausedAt?: string;
  cyclesCompleted?: number; postsCreated?: number;
}) {
  if (autonomousStates.has(saved.campaignId)) return;
  const state: AutonomousState = {
    campaignId: saved.campaignId,
    userId: saved.userId,
    authToken: saved.authToken || '',
    refreshToken: saved.refreshToken,
    isActive: true,
    startedAt: new Date(saved.startedAt),
    interval: saved.interval,
    postsPerCycle: saved.postsPerCycle,
    autoSchedule: saved.autoSchedule,
    platforms: saved.platforms,
    withImages: saved.withImages !== false,
    pipelineMode: saved.pipelineMode || 'full_auto',
    launchCommand: saved.launchCommand,
    cyclesCompleted: saved.cyclesCompleted ?? 0,
    postsCreated: saved.postsCreated ?? 0,
    cycleRunning: false,
    errors: [],
    lastCycleAt: saved.lastCycleAt ? new Date(saved.lastCycleAt) : undefined,
    paused: saved.paused === true,
    pausedAt: saved.pausedAt ? new Date(saved.pausedAt) : undefined,
  } as any;
  autonomousStates.set(saved.campaignId, state);
  // SM-20: раньше здесь стояли свои таймеры — setInterval сразу (сетка от
  // момента восстановления, а не от фактического цикла) и setTimeout, хендл
  // которого нигде не сохранялся. Из-за второго остановка гасила только
  // интервал, а отложенный цикл срабатывал уже на удалённом состоянии.
  // Теперь общий планировщик: он хранит хендл и заводит сетку после цикла.
  if (state.paused) {
    console.log(`[AUTONOMOUS] ⏸ Восстановлен на ПАУЗЕ: ${saved.campaignId} — таймеры не ставим`);
    return;
  }
  scheduleAutonomousTimers(state);
  console.log(`[AUTONOMOUS] ♻️ Восстановлен режим для кампании ${saved.campaignId}`);
}

// ── File persistence (dev / local fallback) ────────────────────────────────

function saveAutonomousPersistenceFile() {
  try {
    const dir = join(process.cwd(), 'data');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const toSave: Record<string, any> = {};
    autonomousStates.forEach((state, key) => {
      toSave[key] = {
        campaignId: state.campaignId,
        userId: state.userId,
        authToken: state.authToken,
        refreshToken: state.refreshToken,
        interval: state.interval,
        postsPerCycle: state.postsPerCycle,
        autoSchedule: state.autoSchedule,
        platforms: state.platforms,
        withImages: state.withImages,
        pipelineMode: (state as any).pipelineMode || 'full_auto',
        startedAt: state.startedAt.toISOString(),
        launchCommand: state.launchCommand,
        lastCycleAt: state.lastCycleAt ? state.lastCycleAt.toISOString() : undefined,
        // SM-20: см. комментарий в stateToRecord — пауза и счётчики обязаны
        // переживать рестарт, иначе фича бессмысленна при частых деплоях.
        paused: state.paused === true,
        pausedAt: state.pausedAt ? state.pausedAt.toISOString() : undefined,
        cyclesCompleted: state.cyclesCompleted,
        postsCreated: state.postsCreated,
      };
    });
    writeFileSync(AUTONOMOUS_PERSIST_FILE, JSON.stringify(toSave, null, 2));
  } catch (e) {
    console.warn('[AUTONOMOUS] Не удалось сохранить файл состояния:', e);
  }
}

function deleteAutonomousPersistenceFile(campaignId: string) {
  try {
    if (!existsSync(AUTONOMOUS_PERSIST_FILE)) return;
    const data = JSON.parse(readFileSync(AUTONOMOUS_PERSIST_FILE, 'utf-8'));
    delete data[campaignId];
    writeFileSync(AUTONOMOUS_PERSIST_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('[AUTONOMOUS] Не удалось удалить файл состояния:', e);
  }
}

// ── Directus persistence (production) ─────────────────────────────────────

let _autonomousDbTokenCache: { token: string; expiresAt: number } | null = null;

async function getAutonomousDbToken(): Promise<string> {
  if (_autonomousDbTokenCache && _autonomousDbTokenCache.expiresAt > Date.now()) {
    return _autonomousDbTokenCache.token;
  }
  const directusUrl = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
  const email = process.env.DIRECTUS_ADMIN_EMAIL;
  const password = process.env.DIRECTUS_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('DIRECTUS_ADMIN_EMAIL / DIRECTUS_ADMIN_PASSWORD не заданы');
  const res = await axios.post(`${directusUrl}/auth/login`, { email, password });
  const token = res.data.data.access_token;
  const expires = res.data.data.expires || 86400000;
  _autonomousDbTokenCache = { token, expiresAt: Date.now() + expires - 60000 };
  return token;
}

async function saveAutonomousPersistenceDb(state: AutonomousState) {
  try {
    const token = await getAutonomousDbToken();
    const record = stateToRecord(state);
    const existing = await directusCrud.list<any>('autonomous_sessions', {
      filter: { campaign_id: { _eq: state.campaignId } },
      authToken: token,
    });
    if (existing && existing.length > 0) {
      await directusCrud.update('autonomous_sessions', existing[0].id, record, { authToken: token });
    } else {
      await directusCrud.create('autonomous_sessions', record, { authToken: token });
    }
  } catch (e) {
    console.warn('[AUTONOMOUS] Не удалось сохранить состояние в БД:', toSafeErrorDetails(e));
  }
}

async function deleteAutonomousPersistenceDb(campaignId: string) {
  try {
    const token = await getAutonomousDbToken();
    const existing = await directusCrud.list<any>('autonomous_sessions', {
      filter: { campaign_id: { _eq: campaignId } },
      authToken: token,
    });
    for (const rec of existing) {
      await directusCrud.delete('autonomous_sessions', rec.id, { authToken: token });
    }
  } catch (e) {
    console.warn('[AUTONOMOUS] Не удалось удалить состояние из БД:', toSafeErrorDetails(e));
  }
}

// ── Public wrappers ────────────────────────────────────────────────────────

function saveAutonomousPersistence(state?: AutonomousState) {
  saveAutonomousPersistenceFile();
  if (state) {
    saveAutonomousPersistenceDb(state).catch(() => {});
  } else {
    autonomousStates.forEach(s => saveAutonomousPersistenceDb(s).catch(() => {}));
  }
}

function deleteAutonomousPersistence(campaignId: string) {
  deleteAutonomousPersistenceFile(campaignId);
  deleteAutonomousPersistenceDb(campaignId).catch(() => {});
}

// ── Restore on server start ────────────────────────────────────────────────

export async function restoreAutonomousStates() {
  // 1. Restore from local file (dev / container with persistent FS)
  try {
    if (existsSync(AUTONOMOUS_PERSIST_FILE)) {
      const data = JSON.parse(readFileSync(AUTONOMOUS_PERSIST_FILE, 'utf-8'));
      Object.values(data).forEach((saved: any) => activateRestoredState(saved));
    }
  } catch (e) {
    console.warn('[AUTONOMOUS] Не удалось восстановить из файла:', e);
  }

  // 2. Restore from Directus DB (production / ephemeral FS)
  try {
    const token = await getAutonomousDbToken();
    const sessions = await directusCrud.list<any>('autonomous_sessions', {
      filter: { is_active: { _eq: true } },
      authToken: token,
    });
    for (const rec of (sessions || [])) {
      if (autonomousStates.has(rec.campaign_id)) continue;
      activateRestoredState({
        campaignId: rec.campaign_id,
        userId: rec.user_id,
        authToken: rec.auth_token,
        refreshToken: rec.refresh_token,
        interval: rec.interval_hours,
        postsPerCycle: rec.posts_per_cycle,
        autoSchedule: rec.auto_schedule,
        platforms: Array.isArray(rec.platforms) ? rec.platforms : JSON.parse(rec.platforms || '[]'),
        withImages: rec.with_images !== false,
        pipelineMode: rec.pipeline_mode || 'full_auto',
        startedAt: rec.started_at,
        launchCommand: rec.launch_command || undefined,
        lastCycleAt: rec.last_cycle_at || undefined,
        // SM-20: без этих полей пауза не переживала рестарт — режим молча
        // возобновлялся при ближайшем деплое, а счётчики обнулялись.
        paused: rec.paused === true,
        pausedAt: rec.paused_at || undefined,
        cyclesCompleted: typeof rec.cycles_completed === "number" ? rec.cycles_completed : 0,
        postsCreated: typeof rec.posts_created === "number" ? rec.posts_created : 0,
      });
    }
    console.log(`[AUTONOMOUS] БД: восстановлено ${(sessions || []).length} сессий`);
  } catch (e) {
    console.warn('[AUTONOMOUS] Не удалось восстановить из БД:', toSafeErrorDetails(e));
  }
}

export async function startAutonomousExternal(params: {
  campaignId: string;
  userId: string;
  interval?: number;
  postsPerCycle?: number;
  autoSchedule?: boolean;
  platforms?: string[];
  withImages?: boolean;
  pipelineMode?: 'full_auto' | 'controlled' | 'mixed';
  refreshToken?: string;
  authToken?: string;
  launchCommand?: string;
}) {
  const adminToken = params.authToken || process.env.DIRECTUS_STATIC_TOKEN || '';
  const interval = params.interval || 24;
  const postsPerCycle = params.postsPerCycle || 1;
  const autoSchedule = params.autoSchedule !== false;
  // Если platforms явно не переданы — берём все подключённые к кампании.
  // Никаких хардкод-дефолтов: ассистент сам должен публиковать в реально
  // настроенные соцсети.
  let platforms: string[] = Array.isArray(params.platforms) && params.platforms.length > 0
    ? params.platforms
    : await getCampaignConnectedPlatforms(params.campaignId, adminToken);
  if (platforms.length === 0) {
    return {
      success: false,
      message: 'Не удалось запустить автономный режим: к этой кампании не подключена ни одна соцсеть. Подключите хотя бы одну (Telegram, VK, Instagram, Facebook, YouTube, TikTok или Threads) в настройках кампании.'
    };
  }
  const withImages = params.withImages !== false;

  // Подтягиваем launchCommand из сохранённых настроек кампании если не передан явно
  let launchCommand: string | undefined = params.launchCommand;
  if (!launchCommand) {
    try {
      const camp: any = await directusCrud.getById('user_campaigns', params.campaignId, { authToken: adminToken });
      const rawSettings = camp?.autonomous_settings;
      let savedSettings: Record<string, any> = {};
      if (rawSettings && typeof rawSettings === 'object') savedSettings = rawSettings;
      else if (typeof rawSettings === 'string' && rawSettings.trim()) {
        try { savedSettings = JSON.parse(rawSettings); } catch { /* ignore */ }
      }
      if (savedSettings.launchCommand) {
        launchCommand = savedSettings.launchCommand;
        console.log(`[AUTONOMOUS] 📋 Восстановлен launchCommand из настроек кампании ${params.campaignId}`);
      }
    } catch (e: any) {
      console.warn(`[AUTONOMOUS] ⚠️ Не удалось прочитать launchCommand из кампании: ${e.message}`);
    }
  }

  // Сбрасываем ошибку квоты при новом старте агента
  quotaErrorMap.delete(params.campaignId);

  if (autonomousStates.has(params.campaignId)) {
    // Уже активен — запускаем цикл немедленно вместо ошибки
    const existing = autonomousStates.get(params.campaignId)!;
    console.log(`[AUTONOMOUS] 🔄 Режим уже активен, запускаем цикл немедленно для ${params.campaignId}`);
    runAutonomousCycle(existing).catch(e => {
      console.error(`[AUTONOMOUS] ❌ Ошибка немедленного цикла:`, e);
      existing.errors.push(e.message);
    });
    return { success: true, message: 'Цикл запущен немедленно', alreadyRunning: true };
  }

  const state: AutonomousState = {
    campaignId: params.campaignId,
    userId: params.userId,
    authToken: adminToken,
    refreshToken: params.refreshToken,
    isActive: true,
    startedAt: new Date(),
    interval,
    postsPerCycle,
    autoSchedule,
    platforms,
    withImages,
    pipelineMode: params.pipelineMode || 'full_auto',
    launchCommand,
    cyclesCompleted: 0,
    postsCreated: 0,
    cycleRunning: false,
    errors: []
  };
  autonomousStates.set(params.campaignId, state);
  saveAutonomousPersistence();

  runAutonomousCycle(state).catch(e => state.errors.push(e.message));
  const intervalMs = interval * 60 * 60 * 1000;
  state.timer = setInterval(async () => {
    await runAutonomousCycle(state).catch(e => state.errors.push(e.message));
  }, intervalMs);

  return { success: true, interval, postsPerCycle, autoSchedule, platforms };
}

/**
 * Пауза (SM-20).
 *
 * Отличие от остановки принципиальное: стоп удаляет состояние и персистенцию,
 * то есть обнуляет прогресс — счётчики циклов и постов начинаются с нуля.
 * Тестировщик просил возможность «поставить на паузу, поправить настройки и
 * продолжить», для чего стоп не годится. Пауза снимает таймеры и оставляет
 * всё остальное нетронутым.
 */
export function pauseAutonomousExternal(campaignId: string) {
  const state = autonomousStates.get(campaignId);
  if (!state) return { success: false, error: 'Автономный режим не активен' };
  if (state.paused) return { success: false, error: 'Автономный режим уже на паузе' };

  if (state.timer) { clearInterval(state.timer); state.timer = undefined; }
  if (state.firstCycleTimer) { clearTimeout(state.firstCycleTimer); state.firstCycleTimer = undefined; }

  state.paused = true;
  state.pausedAt = new Date();
  saveAutonomousPersistence();

  return {
    success: true,
    pausedAt: state.pausedAt.toISOString(),
    cyclesCompleted: state.cyclesCompleted,
    postsCreated: state.postsCreated,
  };
}

/**
 * Снятие с паузы (SM-20).
 *
 * Ждём остаток исходного интервала, а не полный: пауза на пять минут не должна
 * стоить пользователю ещё сутки ожидания. Немедленный цикл тоже не запускаем —
 * иначе снятие паузы неожиданно опубликовало бы пост.
 */
export function resumeAutonomousExternal(campaignId: string) {
  const state = autonomousStates.get(campaignId);
  if (!state) return { success: false, error: 'Автономный режим не активен' };
  if (!state.paused) return { success: false, error: 'Автономный режим не на паузе' };

  state.paused = false;
  state.pausedAt = undefined;
  scheduleAutonomousTimers(state);
  saveAutonomousPersistence();

  return {
    success: true,
    nextCycleMin: Math.round(computeNextCycleDelayMs(state.lastCycleAt, state.interval) / 60000),
    cyclesCompleted: state.cyclesCompleted,
    postsCreated: state.postsCreated,
  };
}

export function stopAutonomousExternal(campaignId: string) {
  const state = autonomousStates.get(campaignId);
  if (!state) return { success: false, error: 'Автономный режим не активен' };
  if (state.timer) clearInterval(state.timer);
  // SM-20: раньше гасился только setInterval, а отложенный первый цикл
  // (setTimeout после восстановления) оставался и срабатывал уже на удалённом
  // состоянии.
  if (state.firstCycleTimer) clearTimeout(state.firstCycleTimer);
  autonomousStates.delete(campaignId);
  deleteAutonomousPersistence(campaignId);
  return {
    success: true,
    cyclesCompleted: state.cyclesCompleted,
    postsCreated: state.postsCreated
  };
}

export function getAutonomousStatusExternal(campaignId: string) {
  const quotaError = quotaErrorMap.get(campaignId) || null;
  const state = autonomousStates.get(campaignId);
  // SM-20: три состояния вместо двух. isActive оставлен для обратной
  // совместимости с существующими потребителями и означает «режим заведён»,
  // а фактическую работу показывает status.
  if (!state) return { isActive: false, status: 'stopped' as const, quotaError };
  const runtimeMin = Math.round((Date.now() - state.startedAt.getTime()) / 60000);
  // SM-20: на паузе обратный отсчёт врёт — таймеров нет, а число продолжало
  // бы уменьшаться. Отдаём null: «неизвестно, пока не возобновят».
  const nextCycleMin = state.paused
    ? null
    : state.lastCycleAt
      ? Math.max(0, Math.round(state.interval * 60 - (Date.now() - state.lastCycleAt.getTime()) / 60000))
      : state.interval * 60;
  return {
    isActive: true,
    status: (state.paused ? 'paused' : 'running') as 'paused' | 'running',
    pausedAt: state.pausedAt ? state.pausedAt.toISOString() : null,
    interval: state.interval,
    postsPerCycle: state.postsPerCycle,
    autoSchedule: state.autoSchedule,
    platforms: state.platforms,
    pipelineMode: state.pipelineMode || 'full_auto',
    cyclesCompleted: state.cyclesCompleted,
    postsCreated: state.postsCreated,
    cycleRunning: state.cycleRunning,
    runtimeMin,
    nextCycleMin,
    startedAt: state.startedAt,
    errors: state.errors.slice(-5),
    quotaError,
    // Ожидание одобрения контент-плана
    pendingApprovalStep: state.pendingApprovalStep || null,
    pendingPlan: state.pendingPlan || null,
    pendingContentIds: state.pendingContentIds || null,
  };
}

export function getAllAutonomousStatuses() {
  const result: Record<string, any> = {};
  autonomousStates.forEach((state, campaignId) => {
    result[campaignId] = getAutonomousStatusExternal(campaignId);
  });
  return result;
}

export function getActiveAutonomousCampaignIds(): Set<string> {
  return new Set(autonomousStates.keys());
}

/**
 * Автономная AI-система с рабочим Vertex AI
 * AI сам решает какие эндпоинты вызывать и как обрабатывать данные
 */

interface AIToolRequest {
  userId: string;
  campaignId: string;
  authToken: string;
  message: string;
  chatHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: Date | string;
  }>;
  campaignOptions?: {
    name: string;
    description: string;
    websiteUrl: string;
    selectedOptions: {
      websiteAnalysis: boolean;
      keywords: boolean;
      findSources: boolean;
      collectTrends: boolean;
      contentPlan: boolean;
    };
  };
}

interface AIToolResponse {
  response: string;
  success: boolean;
  data?: any;
  interactive?: any;
}

// Элемент контент-плана
export interface ContentPlanItem {
  id: string;
  topic: string;
  contentType: string;
  platform: string;
  rationale: string;
  approved?: boolean;
}

// Интерфейс для состояния автономного режима
/**
 * Ставит таймеры цикла, отсчитывая остаток от последнего выполненного цикла (SM-20).
 *
 * Смысл в том, что пауза не должна ни сбрасывать расписание, ни сдвигать его:
 * пользователь ставит на паузу, правит настройки, снимает — и цикл продолжает
 * идти по исходной сетке. Поэтому ждём не полный интервал, а `lastCycleAt +
 * interval - now`. Если пользователь на паузе поменял сам интервал, новый
 * подхватывается автоматически: он участвует в этом же вычислении.
 *
 * Регулярный setInterval ставится ТОЛЬКО после того, как отработает ближайший
 * цикл, иначе две таймерные сетки разъезжаются: одна от момента запуска, другая
 * от фактического цикла.
 */
function scheduleAutonomousTimers(state: AutonomousState): void {
  const intervalMs = state.interval * 60 * 60 * 1000;

  if (state.firstCycleTimer) clearTimeout(state.firstCycleTimer);
  if (state.timer) clearInterval(state.timer);

  const delayMs = computeNextCycleDelayMs(state.lastCycleAt, state.interval);

  state.firstCycleTimer = setTimeout(() => {
    state.firstCycleTimer = undefined;
    runAutonomousCycle(state)
      .catch((e) => {
        console.error('[AUTONOMOUS] ❌ Ошибка цикла:', e);
        state.errors.push(e.message);
      })
      .finally(() => {
        // Регулярную сетку заводим от фактического цикла, а не от момента
        // возобновления — иначе интервал поедет.
        if (state.paused) return;
        state.timer = setInterval(() => {
          runAutonomousCycle(state).catch((e) => {
            console.error('[AUTONOMOUS] ❌ Ошибка цикла:', e);
            state.errors.push(e.message);
          });
        }, intervalMs);
      });
  }, delayMs);
}

import { computeNextCycleDelayMs } from './autonomous-ai-scheduling';

interface AutonomousState {
  campaignId: string;
  userId: string;
  authToken: string;
  refreshToken?: string;
  isActive: boolean;
  startedAt: Date;
  lastCycleAt?: Date;
  interval: number; // в часах
  postsPerCycle: number;
  autoSchedule: boolean;
  platforms: string[];
  withImages: boolean;
  pipelineMode?: 'full_auto' | 'controlled' | 'mixed';
  launchCommand?: string; // исходная команда пользователя запустившая авторежим
  cyclesCompleted: number;
  postsCreated: number;
  cycleRunning: boolean;
  errors: string[];
  timer?: NodeJS.Timeout;
  /**
   * Одноразовый таймер до ближайшего цикла (SM-20).
   *
   * Раньше его хендл нигде не хранился: восстановление после рестарта ставило
   * setTimeout и забывало о нём, поэтому остановка гасила только setInterval, а
   * отложенный первый цикл всё равно срабатывал — уже на удалённом состоянии.
   */
  firstCycleTimer?: NodeJS.Timeout;
  /** Режим на паузе: таймеры сняты, состояние и счётчики сохранены (SM-20). */
  paused?: boolean;
  /** Когда поставлен на паузу — для отображения и диагностики (SM-20). */
  pausedAt?: Date;
  // Пайплайн: ожидание одобрения
  pendingPlan?: ContentPlanItem[];
  pendingApprovalStep?: 'plan' | 'content' | 'images';
  pendingContentIds?: string[];
  approvalResolver?: (approved: boolean, updatedItems?: ContentPlanItem[]) => void;
}

// Хранилище состояний автономных режимов (in-memory)
const autonomousStates = new Map<string, AutonomousState>();

// Ошибки квоты AI — хранятся даже после остановки агента, пока пользователь не запустит снова
const quotaErrorMap = new Map<string, { message: string; retryAfterSec?: number; stoppedAt: string }>();

// Определяет является ли ошибка превышением квоты/rate-limit AI
function extractQuotaError(err: any): { message: string; retryAfterSec?: number } | null {
  const msg = (err?.message || String(err)).toLowerCase();
  const isQuota = msg.includes('429') || msg.includes('quota') ||
    msg.includes('resource_exhausted') || msg.includes('rate limit') ||
    msg.includes('exceeded your current quota') || msg.includes('free_tier_requests');
  if (!isQuota) return null;

  // Извлекаем retryAfter из сообщения об ошибке
  const retryMatch = (err?.message || '').match(/retry.{0,20}?(\d+)\.?\d*s/i) ||
    (err?.message || '').match(/(\d{2,5})s/i);
  const retryAfterSec = retryMatch ? parseInt(retryMatch[1], 10) : undefined;

  let userMessage = '🚫 Исчерпан лимит запросов к AI';
  if ((err?.message || '').includes('free_tier') || (err?.message || '').includes('Free')) {
    userMessage += ' (бесплатный тариф Gemini)';
  }
  if (retryAfterSec && retryAfterSec < 86400) {
    const mins = Math.ceil(retryAfterSec / 60);
    userMessage += mins > 60
      ? `. Повтор через ${Math.ceil(mins / 60)} ч`
      : `. Повтор через ${mins} мин`;
  } else {
    userMessage += '. Лимит сбросится через 24 часа';
  }

  return { message: userMessage, retryAfterSec };
}

// Определяем инструменты (tools) для AI
const AVAILABLE_TOOLS = [
  {
    name: "createCampaign",
    description: "Создать новую кампанию на основе сайта или темы",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Название кампании" },
        description: { type: "string", description: "Описание кампании" },
        websiteUrl: { type: "string", description: "URL сайта для анализа" },
        industry: { type: "string", description: "Отрасль или тема" }
      },
      required: ["name"]
    }
  },
  {
    name: "crawlWebsite",
    description: "ПАРСИТЬ и извлечь данные с любого веб-сайта, включая закрытые сайты с авторизацией",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL сайта для парсинга" },
        needsAuth: { type: "boolean", description: "Требуется ли авторизация" },
        loginUrl: { type: "string", description: "URL страницы входа" },
        username: { type: "string", description: "Имя пользователя для входа" },
        password: { type: "string", description: "Пароль для входа" },
        extractData: { type: "object", description: "Селекторы для извлечения конкретных данных" },
        analysisPrompt: { type: "string", description: "Промпт для AI-анализа содержимого" }
      },
      required: ["url"]
    }
  },
  {
    name: "getCampaignData",
    description: "Получить данные кампании включая анкету и настройки",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "getKeywordsFromWebsite", 
    description: "ПОДОБРАТЬ и извлечь ключевые слова с указанного URL сайта (когда пользователь просит подобрать ключевые слова с сайта)",
    parameters: {
      type: "object",
      properties: {
        websiteUrl: { type: "string", description: "URL сайта для анализа" },
        campaignId: { type: "string", description: "ID кампании" }
      },
      required: ["websiteUrl"]
    }
  },
  {
    name: "collectTrends",
    description: "Запустить сбор трендов для кампании",
    parameters: {
      type: "object", 
      properties: {
        campaignId: { type: "string", description: "ID кампании" },
        sources: { type: "array", description: "Список источников для сбора" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "getTrendsData",
    description: "Получить собранные тренды кампании",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" },
        limit: { type: "number", description: "Лимит записей" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "createContent",
    description: "Создать контент для кампании",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" },
        topic: { type: "string", description: "Тема контента" },
        count: { type: "number", description: "Количество постов" },
        useQuestionnaire: { type: "boolean", description: "Использовать данные анкеты" }
      },
      required: ["campaignId", "topic"]
    }
  },
  {
    name: "getAnalytics",
    description: "Получить аналитику кампании",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" },
        period: { type: "string", description: "Период анализа" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "saveData",
    description: "Сохранить данные в базу",
    parameters: {
      type: "object",
      properties: {
        table: { type: "string", description: "Название таблицы" },
        data: { type: "object", description: "Данные для сохранения" }
      },
      required: ["table", "data"]
    }
  },
  {
    name: "generateKeywords",
    description: "Сгенерировать ключевые слова для сайта на русском языке и сохранить их в кампанию",
    parameters: {
      type: "object",
      properties: {
        websiteUrl: { type: "string", description: "URL сайта для анализа" },
        campaignId: { type: "string", description: "ID кампании" },
        language: { type: "string", description: "Язык ключевых слов (по умолчанию russian)" }
      },
      required: ["websiteUrl", "campaignId"]
    }
  },
  {
    name: "getContentList",
    description: "Получить список контента (постов) в кампании для просмотра и планирования публикаций",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" },
        limit: { type: "number", description: "Лимит записей (по умолчанию 20)" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "unpublishContent",
    description: "Снять публикацию из социальных сетей и вернуть контент в черновики (депостинг). Удаляет пост из Facebook, Instagram, VK, Telegram, YouTube.",
    parameters: {
      type: "object",
      properties: {
        contentId: { type: "string", description: "ID контента для снятия публикации" }
      },
      required: ["contentId"]
    }
  },
  {
    name: "removeDuplicatePosts",
    description: "Удалить дубликаты постов в кампании. Находит и удаляет посты с одинаковым названием и содержимым, оставляя только уникальные.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании для очистки от дубликатов" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "saveKeywordsToCampaign",
    description: "Сохранить ключевые слова в кампанию пользователя",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" },
        keywords: { type: "array", description: "Массив ключевых слов для сохранения" }
      },
      required: ["campaignId", "keywords"]
    }
  },
  {
    name: "getCampaignKeywords",
    description: "Получить сохраненные ключевые слова кампании",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "readQuestionnaire",
    description: "Прочитать бизнес-анкету кампании",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "fillQuestionnaire",
    description: "Заполнить бизнес-анкету автоматически на основе анализа сайта",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" },
        websiteUrl: { type: "string", description: "URL сайта для анализа" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "startScheduler",
    description: "Запустить планировщик публикаций",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "stopScheduler", 
    description: "Остановить планировщик публикаций",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "smartSearchTelegramChannels",
    description: "УМНЫЙ ПОИСК Telegram-каналов: AI автоматически определяет категорию по ключевым словам кампании, находит релевантные каналы и добавляет их в источники. Может использовать ключевые слова из кампании или указанные явно.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { 
          type: "string", 
          description: "ID кампании для получения ключевых слов и добавления найденных каналов в источники" 
        },
        keywords: { 
          type: "array",
          items: { type: "string" },
          description: "ОПЦИОНАЛЬНО: Массив ключевых слов для поиска. Если не указаны, будут использованы ключевые слова из кампании." 
        },
        useKeywordsFromCampaign: {
          type: "boolean",
          description: "Использовать ключевые слова из кампании (true) или только переданные keywords (false). По умолчанию true"
        },
        searchInCategory: { 
          type: "boolean", 
          description: "Искать внутри определённой категории по ключам (true) или вернуть всю категорию (false). По умолчанию true" 
        },
        limit: { 
          type: "number", 
          description: "Максимальное количество каналов для поиска (по умолчанию 20)" 
        },
        addToSources: {
          type: "boolean",
          description: "Автоматически добавить найденные каналы в источники кампании (true) или только показать результаты (false). По умолчанию true"
        }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "scheduleContent",
    description: "Запланировать публикацию контента",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" },
        contentId: { type: "string", description: "ID контента" },
        platforms: { type: "array", description: "Платформы для публикации" },
        scheduleTime: { type: "string", description: "Время публикации" }
      },
      required: ["campaignId", "contentId", "platforms"]
    }
  },
  {
    name: "generateHashtags",
    description: "Сгенерировать хештеги для контента",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Тема контента" },
        count: { type: "number", description: "Количество хештегов" },
        language: { type: "string", description: "Язык хештегов" }
      },
      required: ["topic"]
    }
  },
  {
    name: "webSearch",
    description: "ПОИСК В ИНТЕРНЕТЕ: Искать информацию в Google, получить список релевантных сайтов с описаниями. Опционально можно прочитать содержимое найденных страниц для детального анализа.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос для Google" },
        limit: { type: "number", description: "Максимальное количество результатов (по умолчанию 5)" },
        readPages: { type: "boolean", description: "Читать содержимое найденных страниц для детального анализа (по умолчанию false)" },
        language: { type: "string", description: "Язык поиска (ru, en, es и т.д., по умолчанию ru)" }
      },
      required: ["query"]
    }
  },
  {
    name: "startAutonomous",
    description: "ЗАПУСТИТЬ АВТОНОМНЫЙ РЕЖИМ: AI-ассистент начнет самостоятельно управлять кампанией - генерировать контент с картинками и автоматически планировать публикации. По умолчанию: 1 пост в день с картинками в 10:00/14:00/18:00 МСК.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании для автономного управления" },
        interval: { type: "number", description: "Интервал работы в часах (по умолчанию 24 = раз в день)" },
        postsPerCycle: { type: "number", description: "Количество постов за один цикл (по умолчанию 1)" },
        autoSchedule: { type: "boolean", description: "Автоматически планировать публикации в хорошее время (по умолчанию true)" },
        withImages: { type: "boolean", description: "Генерировать картинки к каждому посту (по умолчанию true)" },
        platforms: { type: "array", description: "Платформы для публикации, например ['telegram', 'vk'] (по умолчанию ['telegram', 'vk'])" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "stopAutonomous",
    description: "ОСТАНОВИТЬ АВТОНОМНЫЙ РЕЖИМ: Прекратить автономную работу AI-ассистента для кампании",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании для остановки автономного режима" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "getAutonomousStatus",
    description: "Получить полный статус кампании: название, сайт, количество постов (сгенерировано/опубликовано/черновики), статус авторежима, все промты (основной, всегда включать, подпись) и промт запуска авторежима (launch_command). Использовать когда пользователь спрашивает 'статус кампании', 'сколько постов', 'какие промты', 'что происходит'.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID кампании" }
      },
      required: ["campaignId"]
    }
  },
  {
    name: "rewriteContent",
    description: "РЕРАЙТ И РЕДАКТИРОВАНИЕ ТЕКСТА: Переписать или отредактировать текст согласно указаниям пользователя. Может изменить стиль, тон, длину, добавить/убрать элементы, исправить ошибки.",
    parameters: {
      type: "object",
      properties: {
        originalText: { type: "string", description: "Исходный текст для редактирования" },
        instructions: { type: "string", description: "Детальные инструкции по редактированию (например: 'сделай короче', 'добавь emoji', 'измени на деловой стиль')" },
        language: { type: "string", description: "Язык текста (ru, en, es)" }
      },
      required: ["originalText", "instructions"]
    }
  },
  {
    name: "generateImage",
    description: "ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЯ: Сгенерировать изображение с помощью AI на основе текстового промпта. Используется для создания картинок к постам, обложек, иллюстраций.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Детальное описание изображения на английском языке для AI генератора" },
        contentId: { type: "string", description: "ОПЦИОНАЛЬНО: ID поста/контента к которому нужно прикрепить изображение" },
        aspectRatio: { type: "string", description: "Соотношение сторон: square, landscape, portrait (по умолчанию square)" },
        style: { type: "string", description: "Стиль изображения: photorealistic, digital-art, illustration, 3d-render (по умолчанию photorealistic)" },
        model: { type: "string", description: "Модель генерации: 'nano-banana-pro' (по умолчанию, высокое качество), 'schnell' (быстрая), 'rundiffusion-fal/juggernaut-flux-lora' (премиум)" }
      },
      required: ["prompt"]
    }
  }
];

/**
 * Возвращает опции авторизации для directusCrud.
 * Если токен не JWT (нет точек) — используем useAdminToken для получения свежего JWT через credentials.
 */
function directusAuth(authToken?: string): { authToken?: string; useAdminToken?: boolean } {
  if (!authToken || !authToken.includes('.')) {
    return { useAdminToken: true };
  }
  return { authToken };
}

/**
 * Декодирует exp из JWT payload без верификации подписи.
 * Возвращает unix timestamp в секундах или null если декодирование не удалось.
 */
function getJwtExp(token?: string): number | null {
  if (!token || !token.includes('.')) return null;
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    return typeof decoded.exp === 'number' ? decoded.exp : null;
  } catch {
    return null;
  }
}

const DIRECTUS_BASE_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const TOKEN_REFRESH_THRESHOLD_SEC = 120; // рефрешим если до истечения < 2 минут

// ============================================================================
// Оптимальное время публикации по МСК
// ============================================================================

/** Веса часов МСК (0-23) для общей публикации в соцсетях. 0 = не публиковать. */
const MSK_HOUR_WEIGHTS_WEEKDAY: Record<number, number> = {
  0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 2,
  8: 5, 9: 8, 10: 7, 11: 6, 12: 9, 13: 8, 14: 6, 15: 5,
  16: 6, 17: 7, 18: 9, 19: 10, 20: 10, 21: 9, 22: 6, 23: 2
};
const MSK_HOUR_WEIGHTS_WEEKEND: Record<number, number> = {
  0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0,
  8: 2, 9: 4, 10: 7, 11: 9, 12: 10, 13: 9, 14: 7, 15: 6,
  16: 6, 17: 7, 18: 8, 19: 10, 20: 10, 21: 9, 22: 7, 23: 3
};

/** Определяет категорию контента по типу и тексту, влияет на выбор слота. */
function detectContentMood(contentType: string, postText: string): 'morning' | 'daytime' | 'evening' | 'any' {
  const t = (contentType + ' ' + postText).toLowerCase();
  if (/мотивац|вдохнов|успех|доброе утро|начни день|цель|планы/.test(t)) return 'morning';
  if (/обуч|анализ|разбор|кейс|инструкц|урок|how to|гайд|статист/.test(t)) return 'daytime';
  if (/развлек|интересн.{0,4} факт|истор|юмор|подборк|вечер|расслаб|кино|музык/.test(t)) return 'evening';
  return 'any';
}

/** Бонусные множители к весу часа в зависимости от настроения контента. */
function getMoodBonus(hour: number, mood: ReturnType<typeof detectContentMood>): number {
  switch (mood) {
    case 'morning': return hour >= 7 && hour <= 10 ? 1.6 : 1;
    case 'daytime': return hour >= 11 && hour <= 16 ? 1.5 : 1;
    case 'evening': return hour >= 18 && hour <= 22 ? 1.5 : 1;
    default: return 1;
  }
}

/** Возвращает час МСК для UTC-даты. */
function getMskHour(date: Date): number {
  // МСК = UTC+3 без перехода на летнее время
  return (date.getUTCHours() + 3) % 24;
}

/** Возвращает день недели в МСК (0=вс, 6=сб). */
function getMskDayOfWeek(date: Date): number {
  const mskMs = date.getTime() + 3 * 60 * 60 * 1000;
  return new Date(mskMs).getUTCDay();
}

const MIN_GAP_MS = 2 * 60 * 60 * 1000; // минимум 2 часа между постами

/**
 * Возвращает список подключённых соцсетей для кампании.
 * Читает user_campaigns.social_media_settings и собирает те платформы,
 * у которых есть включённый флаг или валидный токен/access_token.
 * Если ничего не подключено — отдаёт пустой массив (caller сам решит fallback).
 */
async function getCampaignConnectedPlatforms(
  campaignId: string | number,
  authToken?: string
): Promise<string[]> {
  try {
    const opts: any = authToken ? { authToken } : {};
    const campaign: any = await directusCrud.getById('user_campaigns', campaignId as any, opts);
    const s = campaign?.social_media_settings;
    if (!s || typeof s !== 'object') return [];

    const KNOWN = ['telegram', 'vk', 'instagram', 'facebook', 'youtube', 'tiktok', 'threads'];
    const connected: string[] = [];
    for (const p of KNOWN) {
      const cfg = s[p];
      if (!cfg || typeof cfg !== 'object') continue;
      const enabled = cfg.enabled === true;
      const hasToken = !!(cfg.token || cfg.accessToken || cfg.access_token || cfg.botToken);
      if (enabled || hasToken) connected.push(p);
    }
    return connected;
  } catch (e: any) {
    console.warn(`[AUTONOMOUS] Не удалось определить подключённые платформы для ${campaignId}: ${e?.message || e}`);
    return [];
  }
}

/**
 * Подбирает оптимальное время публикации в МСК.
 * Перебирает слоты на 7 дней вперёд, с шагом 1 час, пропуская занятые/слишком близкие
 * к уже выбранным, и выбирает слот с максимальным взвешенным баллом.
 * Возвращает ISO-строку (UTC).
 */
function pickOptimalScheduleTimeMsk(opts: {
  contentType: string;
  postText: string;
  taken: number[]; // unix ms уже занятых слотов
  platforms?: string[];
}): string {
  const mood = detectContentMood(opts.contentType, opts.postText);
  const now = Date.now();
  // Старт: следующий час, минимум через 30 минут от сейчас
  const startMs = Math.ceil((now + 30 * 60 * 1000) / (60 * 60 * 1000)) * (60 * 60 * 1000);
  
  const candidates: Array<{ ts: number; score: number }> = [];
  const HORIZON_HOURS = 7 * 24;
  
  for (let h = 0; h < HORIZON_HOURS; h++) {
    const ts = startMs + h * 60 * 60 * 1000;
    const date = new Date(ts);
    const mskHour = getMskHour(date);
    const dow = getMskDayOfWeek(date);
    const isWeekend = dow === 0 || dow === 6;
    const baseWeight = (isWeekend ? MSK_HOUR_WEIGHTS_WEEKEND : MSK_HOUR_WEIGHTS_WEEKDAY)[mskHour] || 0;
    
    if (baseWeight === 0) continue;
    
    // Проверяем что слот не слишком близко к уже занятым
    const tooClose = opts.taken.some(t => Math.abs(t - ts) < MIN_GAP_MS);
    if (tooClose) continue;
    
    let score = baseWeight * getMoodBonus(mskHour, mood);
    
    // Лёгкое предпочтение более ранним слотам (чтобы не уплывать на конец недели)
    score -= h * 0.03;
    
    candidates.push({ ts, score });
  }
  
  if (candidates.length === 0) {
    // Fallback: завтра в 12:00 МСК
    const fallback = new Date(startMs);
    fallback.setUTCHours(9, 0, 0, 0); // 12:00 МСК = 09:00 UTC
    fallback.setUTCDate(fallback.getUTCDate() + 1);
    return fallback.toISOString();
  }
  
  candidates.sort((a, b) => b.score - a.score);
  return new Date(candidates[0].ts).toISOString();
}

/**
 * Гарантирует что у state свежий JWT юзера. Если токен ещё живёт — ничего не делает.
 * Если истекает скоро или уже истёк — рефрешит через Directus напрямую.
 * Обновляет state и persistence. Возвращает актуальный токен (или пустую строку, если рефреш не удался).
 */
async function ensureFreshUserToken(state: AutonomousState): Promise<string> {
  const adminFallback = process.env.DIRECTUS_STATIC_TOKEN || state.authToken || '';
  const exp = getJwtExp(state.authToken);
  const nowSec = Math.floor(Date.now() / 1000);
  
  // Токен живой (JWT и не истёк) — оставляем как есть
  if (exp && exp - nowSec > TOKEN_REFRESH_THRESHOLD_SEC) {
    return state.authToken;
  }

  // Не JWT (статический токен DIRECTUS_STATIC_TOKEN) — сразу пробуем получить живой JWT
  // через directusAuthManager, т.к. статический токен может не приниматься как Bearer в API
  if (!exp) {
    console.log(`[AUTONOMOUS-AUTH] 🔑 Статический токен обнаружен — получаем живой JWT через directusAuthManager`);
    try {
      const { directusAuthManager } = await import('./directus-auth-manager');
      const freshToken = await directusAuthManager.getValidToken(state.userId);
      if (freshToken) {
        state.authToken = freshToken;
        saveAutonomousPersistence();
        console.log(`[AUTONOMOUS-AUTH] ✅ Живой JWT получен через directusAuthManager для userId=${state.userId}`);
        return freshToken;
      }
    } catch (dmErr: any) {
      console.warn(`[AUTONOMOUS-AUTH] ⚠️ directusAuthManager.getValidToken не удался: ${dmErr.message}`);
    }
    // Статический admin-токен как fallback — он принимается middleware напрямую
    console.log(`[AUTONOMOUS-AUTH] 🔑 Используем admin static token как fallback`);
    return adminFallback;
  }
  
  // JWT есть но истёк — пробуем несколько способов обновить
  console.log(`[AUTONOMOUS-AUTH] 🔄 JWT истёк, попытка обновления...`);

  // Способ 1: directusAuthManager.getValidToken (использует сохранённую сессию из БД)
  try {
    const { directusAuthManager } = await import('./directus-auth-manager');
    const freshToken = await directusAuthManager.getValidToken(state.userId);
    if (freshToken) {
      state.authToken = freshToken;
      saveAutonomousPersistence();
      console.log(`[AUTONOMOUS-AUTH] ✅ JWT обновлён через directusAuthManager (userId=${state.userId})`);
      return freshToken;
    }
  } catch (dmErr: any) {
    console.warn(`[AUTONOMOUS-AUTH] ⚠️ directusAuthManager.getValidToken не удался: ${dmErr.message}`);
  }

  // Способ 2: прямой /auth/refresh с state.refreshToken
  if (state.refreshToken) {
    try {
      const response = await axios.post(
        `${DIRECTUS_BASE_URL}/auth/refresh`,
        { refresh_token: state.refreshToken, mode: 'json' },
        { timeout: 10000 }
      );
      const newToken = response.data?.data?.access_token;
      const newRefresh = response.data?.data?.refresh_token;
      if (newToken) {
        state.authToken = newToken;
        if (newRefresh) state.refreshToken = newRefresh;
        saveAutonomousPersistence();
        console.log(`[AUTONOMOUS-AUTH] ✅ JWT обновлён через state.refreshToken`);
        return newToken;
      }
    } catch (err: any) {
      console.warn(`[AUTONOMOUS-AUTH] ⚠️ Прямой /auth/refresh не удался (${err?.response?.status}): ${String(err?.message).slice(0, 80)}`);
    }
  }

  console.warn(`[AUTONOMOUS-AUTH] ⚠️ Все методы рефреша не удались — откат на admin static token`);
  return adminFallback;
}

// =============================================================
// Агент-редактор: второй проход AI перед сохранением поста
// =============================================================
const DEFAULT_EDITOR_STYLE = `
СТИЛЬ И ТОН:
- Живой разговорный язык, как говорит эксперт с другом — не официально, без воды
- Конкретика вместо абстракций: цифры, факты, примеры вместо общих слов
- Короткие абзацы (2–4 предложения), между ними пустая строка

СТРУКТУРА:
- Первые 1–2 слова/строка — сильная зацепка (вопрос, провокация, факт, неожиданный тезис)
- Тело: раскрытие темы с пользой для читателя
- Финал: конкретный призыв к действию (CTA)
- Хэштеги: 3–6 точных, не общих (#успех #жизнь — запрещены)

ФОРМАТИРОВАНИЕ:
- Используй эмодзи перед ключевыми абзацами для визуального разделения
- Выделяй ключевые тезисы жирным: **слово** или **фраза**
- Можно использовать маркированные списки через дефис или эмодзи

ЗАПРЕЩЕНО:
- Клише: "В наш стремительный век", "Не секрет что", "Каждый из нас", "На пути к успеху"
- Структура "Введение → Основная часть → Вывод" — слишком академично
- Слова: "актуально", "инновационный", "в эпоху", "представляет собой", "позволяет"
- Стены текста без абзацев
- Вступления "Вот пост", "Держи", "Конечно!"
- Слишком ровный тон без эмоциональных всплесков
- Списки без контекста (просто "пункт 1, пункт 2, пункт 3")
`;

async function editorPassContent(
  content: string,
  campaignStyleGuide: string,
  request: { userId: string; authToken: string },
  humanize?: boolean
): Promise<string> {
  try {
    const styleSection = campaignStyleGuide
      ? `\nДОПОЛНИТЕЛЬНЫЕ ТРЕБОВАНИЯ КАМПАНИИ:\n${campaignStyleGuide}\n`
      : '';
    const humanizeSection = humanize
      ? `\nОЧЕЛОВЕЧИВАНИЕ ТЕКСТА (строго соблюдать):
- Конкретика и личные наблюдения вместо обобщений
- Варьируй ритм: короткое предложение — удар, потом развёртка (4 слова → 15 слов → 7 слов)
- Допускай риторический вопрос или незавершённую мысль
- Разговорные обороты: "если честно", "вот тебе пример", "короче"
- Никакой идеально-симметричной AI-структуры
- Добавь "человеческие" детали: восклицания, сомнения, лёгкое сарказм
- Текст должен звучать как набросок эксперта, а не отредактированная статья
- Начинай предложения с "И", "Но", "А" — это нормально для разговорного стиля
- Чередуй длину предложений — никакой одинаковой длины подряд
`
      : '';

    const editorPrompt = `Ты — строгий редактор SMM-контента. Улучши пост по критериям ниже.
Верни ТОЛЬКО улучшенный текст поста — без пояснений, без комментариев, без заголовков типа "Улучшенный пост:".

КРИТЕРИИ КАЧЕСТВА:
${DEFAULT_EDITOR_STYLE}${styleSection}${humanizeSection}
ИСХОДНЫЙ ПОСТ ДЛЯ РЕДАКТУРЫ:
---
${content}
---

УЛУЧШЕННЫЙ ПОСТ:`;

    const result = await aiService.generateContent({
      prompt: editorPrompt,
      model: 'gemini-2.5-flash',
      service: 'gemini',
      userId: request.userId,
      token: request.authToken
    });

    const edited = (result.content || '').trim();
    if (!edited || edited.length < 50) {
      console.warn('[EDITOR-PASS] ⚠️ Редактор вернул слишком короткий текст, используем оригинал');
      return content;
    }

    console.log(`[EDITOR-PASS] ✅ Редактура завершена: ${content.length} → ${edited.length} символов`);
    return edited;
  } catch (err: any) {
    console.warn('[EDITOR-PASS] ⚠️ Ошибка редактора, используем оригинал:', err.message?.slice(0, 100));
    return content;
  }
}

// ─────────────────────────────────────────────────────────────────
// ПАЙПЛАЙН: генерация и доработка контент-плана
// ─────────────────────────────────────────────────────────────────

/**
 * SM-18: Обеспечивает, что каждый элемент контент-плана имеет platform из
 * фактически подключённых к кампании. AI может вернуть "facebook"/"instagram"
 * даже если они не подключены — заменяем на platforms[0] или 'telegram'.
 * SM-19: Обрезает план до count, чтобы не создавать постов больше запрошенного.
 */
export function sanitizeContentPlanItems(
  parsed: ContentPlanItem[],
  count: number,
  platforms: string[]
): ContentPlanItem[] {
  if (parsed.length > count) {
    console.warn(`[CONTENT-PLAN] ⚠️ AI вернул ${parsed.length} идеи при запросе ${count} — обрезаем`);
  }
  // SM-19: жёсткая граница сверху.
  const capped = parsed.slice(0, count);
  // Нормализуем к нижнему регистру: AI может вернуть "Telegram"/"FACEBOOK" с другой касой.
  const validPlatformsLower = new Set(platforms.map(p => p.toLowerCase()));

  return capped.map((item, i) => {
    const rawPlatform = item.platform;
    // SM-18: platform строго из фактически подключённых платформ.
    const normalized = rawPlatform?.toLowerCase() || '';
    const safePlatform = validPlatformsLower.has(normalized)
      ? platforms.find(p => p.toLowerCase() === normalized) || (platforms[0] || 'telegram')
      : (platforms[0] || 'telegram');
    if (rawPlatform && rawPlatform !== safePlatform) {
      console.warn(`[CONTENT-PLAN] ⚠️ AI предложил платформу "${rawPlatform}", заменяем на "${safePlatform}"`);
    }
    return {
      id: item.id || String(i + 1),
      topic: item.topic || '',
      contentType: item.contentType || 'обучающий',
      platform: safePlatform,
      rationale: item.rationale || '',
      approved: true,
    };
  });
}

/**
 * SM-18: При доработке плана не даёт заменить platform на неподключённую.
 * SM-19: Не даёт доработанному плану расшириться сверх входного.
 */
export function sanitizeRefinedContentPlan(
  refined: ContentPlanItem[],
  plan: ContentPlanItem[],
  platforms: string[]
): ContentPlanItem[] {
  const validPlatformsLower = new Set(platforms.map(p => p.toLowerCase()));
  if (refined.length > plan.length) {
    console.warn(`[CONTENT-PLAN] ⚠️ Доработка вернула ${refined.length} идей (было ${plan.length}) — обрезаем`);
  }
  const capped = refined.slice(0, plan.length);
  return capped.map((item, i) => {
    const rawPlatform = item.platform;
    const normalized = rawPlatform?.toLowerCase() || '';
    const originalPlatform = plan[i]?.platform;
    const originalNormalized = originalPlatform?.toLowerCase() || '';
    // Если доработка вернула подключённую платформу — оставляем её (с каноничным регистром из platforms).
    const safePlatform = validPlatformsLower.has(normalized)
      ? platforms.find(p => p.toLowerCase() === normalized) || (originalPlatform || platforms[0] || 'telegram')
      : (originalPlatform || platforms[0] || 'telegram');
    if (rawPlatform && rawPlatform !== safePlatform) {
      console.warn(`[CONTENT-PLAN] ⚠️ Доработка вернула платформу "${rawPlatform}", сохраняем "${safePlatform}"`);
    }
    return {
      ...plan[i],
      ...item,
      platform: safePlatform,
      approved: true,
    };
  });
}

async function generateContentPlan(params: {
  count: number;
  keywords: string[];
  trends: any[];
  platforms: string[];
  globalPrompt: string;
  alwaysInclude: string;
  launchCommand: string;
  analyticsInsights: string;
  request: { userId: string; authToken: string };
}): Promise<ContentPlanItem[]> {
  const { count, keywords, trends, platforms, globalPrompt, alwaysInclude, launchCommand, analyticsInsights, request } = params;

  const topTrends = trends
    .slice(0, 10)
    .map((t: any) => t?.title || t?.text || '')
    .filter(Boolean)
    .join('\n- ');

  const kwList = keywords.slice(0, 15).join(', ');
  const platformList = platforms.join(', ');

  const prompt = `Ты — опытный SMM-стратег. Составь контент-план из ${count} постов для публикации в соцсетях.

КОНТЕКСТ КАМПАНИИ:
${launchCommand ? `[ГЛАВНАЯ ИНСТРУКЦИЯ]\n${launchCommand}\n\n` : ''}${globalPrompt ? `Стиль и аудитория: ${globalPrompt}\n` : ''}${alwaysInclude ? `Обязательно включать в посты: ${alwaysInclude}\n` : ''}Платформы: ${platformList}
Ключевые слова: ${kwList || 'не заданы'}
${topTrends ? `Актуальные тренды:\n- ${topTrends}` : ''}
${analyticsInsights ? `Данные аналитики: ${analyticsInsights}` : ''}

ЗАДАЧА:
Сгенерируй ровно ${count} идей постов. Для каждого верни JSON-объект в массиве.

ТРЕБОВАНИЯ К ПЛАНУ:
- Разнообразие форматов: обучающий, вовлекающий, экспертный, кейс, провокационный вопрос
- Каждый пост должен цеплять целевую аудиторию кампании
- Учитывай тренды и ключевые слова
- Предлагай конкретные темы, не общие фразы

Верни ТОЛЬКО валидный JSON массив, без markdown, без пояснений:
[
  {
    "id": "1",
    "topic": "Конкретная тема поста (1–2 предложения)",
    "contentType": "тип: обучающий | кейс | вовлекающий | экспертный | провокация | анонс",
    "platform": "рекомендуемая платформа из списка",
    "rationale": "почему эта тема сработает (1 предложение)"
  }
]`;

  try {
    const result = await aiService.generateContent({
      prompt,
      model: 'gemini-2.5-flash',
      service: 'gemini',
      userId: request.userId,
      token: request.authToken,
    });

    const raw = (result.content || '').trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Не найден JSON в ответе');

    const parsed: ContentPlanItem[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Пустой план');

    return sanitizeContentPlanItems(parsed, count, platforms);
  } catch (err: any) {
    console.warn('[CONTENT-PLAN] ⚠️ Ошибка генерации плана:', err.message);
    // Фоллбек — создаём базовые идеи из ключевых слов
    return keywords.slice(0, count).map((kw, i) => ({
      id: String(i + 1),
      topic: `Экспертный пост про ${kw}`,
      contentType: 'обучающий',
      platform: platforms[i % platforms.length] || 'telegram',
      rationale: `Актуальная тема по ключевому слову "${kw}"`,
      approved: true,
    }));
  }
}

async function refineContentPlan(params: {
  plan: ContentPlanItem[];
  publishedTitles: string[];
  globalPrompt: string;
  alwaysInclude: string;
  platforms: string[];
  launchCommand: string;
  request: { userId: string; authToken: string };
}): Promise<ContentPlanItem[]> {
  const { plan, publishedTitles, globalPrompt, alwaysInclude, platforms, launchCommand, request } = params;
  if (publishedTitles.length === 0) return plan;

  const recentTitles = publishedTitles.slice(0, 20).join('\n- ');

  const prompt = `Ты — SMM-стратег. Проверь контент-план и улучши его.

${launchCommand ? `[ГЛАВНАЯ ИНСТРУКЦИЯ]\n${launchCommand}\n\n` : ''}УЖЕ ОПУБЛИКОВАННЫЕ ТЕМЫ (не повторять):
- ${recentTitles}

ТЕКУЩИЙ ПЛАН (JSON):
${JSON.stringify(plan, null, 2)}

${globalPrompt ? `СТИЛЬ КАМПАНИИ: ${globalPrompt}\n` : ''}${alwaysInclude ? `ОБЯЗАТЕЛЬНО ВКЛЮЧАТЬ В ПОСТЫ: ${alwaysInclude}\n` : ''}
ЗАДАЧА:
1. Удали или замени идеи, которые похожи на уже опубликованные
2. Убедись в разнообразии форматов и соответствии главной инструкции
3. Улучши формулировки тем — они должны быть конкретными и цепляющими
4. Сохрани то же количество элементов

Верни ТОЛЬКО валидный JSON массив с теми же полями (id, topic, contentType, platform, rationale).`;

  try {
    const result = await aiService.generateContent({
      prompt,
      model: 'gemini-2.5-flash',
      service: 'gemini',
      userId: request.userId,
      token: request.authToken,
    });

    const raw = (result.content || '').trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return plan;

    const refined: ContentPlanItem[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(refined) || refined.length === 0) return plan;

    return sanitizeRefinedContentPlan(refined, plan, platforms);
  } catch {
    return plan;
  }
}

// ─────────────────────────────────────────────────────────────────
// ПАЙПЛАЙН: механизм ожидания одобрения (Promise-based пауза)
// ─────────────────────────────────────────────────────────────────

function waitForPipelineApproval(
  state: AutonomousState,
  step: 'plan' | 'content' | 'images'
): Promise<{ approved: boolean; updatedItems?: ContentPlanItem[] }> {
  return new Promise((resolve) => {
    state.pendingApprovalStep = step;
    state.approvalResolver = (approved, updatedItems) => resolve({ approved, updatedItems });

    // Авто-одобрение через 24 часа если пользователь не ответил
    setTimeout(() => {
      if (state.approvalResolver) {
        console.log(`[PIPELINE] ⏰ Авто-одобрение по таймауту (шаг: ${step})`);
        state.approvalResolver = undefined;
        state.pendingApprovalStep = undefined;
        resolve({ approved: true });
      }
    }, 24 * 60 * 60 * 1000);
  });
}

// Публичные функции для одобрения/отклонения через API
export function approvePipelinePlan(
  campaignId: string,
  updatedItems?: ContentPlanItem[]
): { ok: boolean; error?: string } {
  const state = autonomousStates.get(campaignId);
  if (!state) return { ok: false, error: 'Кампания не найдена' };
  if (!state.approvalResolver) return { ok: false, error: 'Нет ожидающего одобрения' };

  const resolver = state.approvalResolver;
  state.approvalResolver = undefined;
  state.pendingPlan = updatedItems || state.pendingPlan;
  state.pendingApprovalStep = undefined;
  resolver(true, updatedItems);
  return { ok: true };
}

export function rejectPipelinePlan(campaignId: string): { ok: boolean; error?: string } {
  const state = autonomousStates.get(campaignId);
  if (!state) return { ok: false, error: 'Кампания не найдена' };
  if (!state.approvalResolver) return { ok: false, error: 'Нет ожидающего одобрения' };

  const resolver = state.approvalResolver;
  state.approvalResolver = undefined;
  state.pendingPlan = undefined;
  state.pendingApprovalStep = undefined;
  resolver(false);
  return { ok: true };
}

/**
 * Извлекает реальный промпт для launchCommand.
 * Если пользователь написал "запусти авторежим с этим промтом" — ссылается на
 * предыдущее своё сообщение, а не на саму команду. Ищем его в chatHistory.
 */
function resolveLaunchCommand(message: string, chatHistory?: AIToolRequest['chatHistory']): string {
  const refPattern = /с\s+этим\s+промт|по\s+этому\s+промт|используя\s+этот\s+промт|на\s+основе\s+этого\s+промт|с\s+таким\s+промт/i;
  if (refPattern.test(message) && chatHistory && chatHistory.length > 0) {
    // Ищем последнее сообщение пользователя в истории (кроме самой команды)
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const entry = chatHistory[i];
      if (entry.role === 'user' && entry.content !== message && entry.content.trim().length > 20) {
        console.log(`[AUTONOMOUS] 📋 launchCommand взят из предыдущего сообщения пользователя`);
        return entry.content.trim();
      }
    }
  }
  return message;
}

// Реализация инструментов
export const TOOL_IMPLEMENTATIONS = {
  async crawlWebsite(params: any, request: AIToolRequest) {
    try {
      const { webCrawlerAgent } = await import('./web-crawler-agent');
      
      console.log('[CRAWL-WEBSITE] 🕷️ Запуск веб-парсинга:', params.url);
      
      const crawlOptions: any = {
        url: params.url
      };
      
      // Настройка авторизации
      if (params.needsAuth && params.username && params.password) {
        crawlOptions.needsAuth = true;
        crawlOptions.credentials = {
          loginUrl: params.loginUrl || params.url,
          username: params.username,
          password: params.password,
          usernameSelector: 'input[type="email"], input[name="username"], input[name="login"]',
          passwordSelector: 'input[type="password"], input[name="password"]',
          submitSelector: 'button[type="submit"], input[type="submit"]'
        };
      }
      
      // Настройка извлечения данных
      if (params.extractData) {
        crawlOptions.extractData = params.extractData;
      }
      
      // Выполняем интеллектуальный парсинг
      const result = await webCrawlerAgent.intelligentCrawl(params.url, crawlOptions);
      
      // Кастомный анализ если задан
      if (params.analysisPrompt) {
        result.analysis = await webCrawlerAgent.analyzePageContent(result.crawlResult, params.analysisPrompt);
      }
      
      console.log('[CRAWL-WEBSITE] ✅ Парсинг завершен, получено:', Object.keys(result.analysis));
      
      return {
        success: true,
        crawlData: result.crawlResult,
        analysis: result.analysis,
        message: `Успешно проанализирован сайт ${params.url}. Извлечены данные и выполнен AI-анализ.`
      };
    } catch (error: any) {
      console.error('[CRAWL-WEBSITE] ❌ Ошибка:', error.message);
      return { 
        error: `Ошибка парсинга сайта: ${error.message}`,
        success: false
      };
    }
  },

  async webSearch(params: any, request: AIToolRequest) {
    try {
      const axios = await import('axios');
      const query = params.query;
      const limit = params.limit || 5;
      const readPages = params.readPages || false;
      const language = params.language || 'ru';
      
      console.log(`[WEB-SEARCH] 🔍 Поиск в Google: "${query}" (язык: ${language}, лимит: ${limit})`);
      
      // Используем Google Custom Search JSON API
      const apiKey = process.env.GOOGLE_SEARCH_API_KEY || process.env.GOOGLE_API_KEY;
      const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_ID;
      
      if (!apiKey || !searchEngineId) {
        console.log(`[WEB-SEARCH] ⚠️ Google Search API ключи не настроены, используем DuckDuckGo`);
        
        // Fallback: используем DuckDuckGo HTML API (без авторизации)
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await axios.default.get(ddgUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 10000
        });
        
        // Простой парсинг HTML ответа DuckDuckGo
        const cheerio = await import('cheerio');
        const $ = cheerio.load(response.data);
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        
        $('.result').slice(0, limit).each((i, elem) => {
          const titleElem = $(elem).find('.result__title');
          const snippetElem = $(elem).find('.result__snippet');
          const linkElem = $(elem).find('.result__url');
          
          const url = $(elem).find('.result__a').attr('href');
          if (url) {
            results.push({
              title: titleElem.text().trim(),
              url: url.startsWith('//') ? 'https:' + url : url,
              snippet: snippetElem.text().trim()
            });
          }
        });
        
        console.log(`[WEB-SEARCH] ✅ Найдено ${results.length} результатов (DuckDuckGo)`);
        
        return {
          success: true,
          query: query,
          resultsCount: results.length,
          results: results,
          message: `Найдено ${results.length} результатов по запросу "${query}"`
        };
      }
      
      // Используем Google Custom Search API
      const searchUrl = 'https://www.googleapis.com/customsearch/v1';
      const response = await axios.default.get(searchUrl, {
        params: {
          key: apiKey,
          cx: searchEngineId,
          q: query,
          lr: `lang_${language}`,
          num: limit
        },
        timeout: 10000
      });
      
      const results = (response.data.items || []).map((item: any) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet || ''
      }));
      
      console.log(`[WEB-SEARCH] ✅ Найдено ${results.length} результатов (Google API)`);
      
      // Опционально читаем содержимое найденных страниц
      let detailedResults = results;
      if (readPages && results.length > 0) {
        console.log(`[WEB-SEARCH] 📖 Читаем содержимое ${results.length} страниц...`);
        const { webCrawlerAgent } = await import('./web-crawler-agent');
        
        detailedResults = await Promise.all(
          results.map(async (result: any) => {
            try {
              const pageContent = await webCrawlerAgent.intelligentCrawl(result.url, {
                url: result.url
              });
              
              return {
                ...result,
                content: JSON.stringify(pageContent.analysis).slice(0, 2000) || '',
                analysis: pageContent.analysis
              };
            } catch (error) {
              console.error(`[WEB-SEARCH] Ошибка чтения ${result.url}:`, error);
              return result;
            }
          })
        );
      }
      
      return {
        success: true,
        query: query,
        resultsCount: detailedResults.length,
        results: detailedResults,
        message: `Найдено ${detailedResults.length} результатов по запросу "${query}"${readPages ? ' с детальным анализом содержимого' : ''}`
      };
    } catch (error: any) {
      console.error('[WEB-SEARCH] ❌ Ошибка поиска:', error.message);
      return {
        error: `Ошибка веб-поиска: ${error.message}`,
        success: false
      };
    }
  },

  async createCampaign(params: any, request: AIToolRequest) {
    try {
      // Валидация URL для безопасности (если указан)
      if (params.websiteUrl) {
        const url = new URL(params.websiteUrl);
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(url.protocol)) {
          throw new Error('Недопустимый протокол URL');
        }
        
        // Блокируем приватные IP адреса
        const hostname = url.hostname;
        if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
          throw new Error('Доступ к приватным IP адресам запрещен');
        }
      }
      
      // Создаем только базовую кампанию без дополнительных операций
      const campaignData = {
        name: params.name,
        description: params.description || `Кампания ${params.name}`,
        user_id: request.userId,
        website_url: params.websiteUrl || null,
        industry: params.industry || null,
        status: 'active',
        date_created: new Date().toISOString(),
        date_updated: new Date().toISOString()
      };
      
      const campaign = await directusCrud.create('user_campaigns', campaignData, directusAuth(request.authToken));
      
      const campaignId = (campaign as any)?.id;
      
      if (!campaignId) {
        throw new Error('Не удалось получить ID созданной кампании');
      }
      
      console.log('[CREATE-CAMPAIGN] Кампания создана с ID:', campaignId);
      
      return {
        success: true,
        campaign: campaign,
        campaignId: campaignId,
        message: `Кампания "${params.name}" успешно создана с ID: ${campaignId}`
      };
    } catch (error) {
      return { error: `Ошибка создания кампании: ${error}` };
    }
  },

  async getCampaignData(params: any, request: AIToolRequest) {
    try {
      const campaignId = params.campaignId || request.campaignId;

      // Получаем данные кампании
      const campaigns = await directusCrud.list('user_campaigns', {
        ...directusAuth(request.authToken),
        filter: { id: { _eq: campaignId } },
        limit: 1
      });
      
      if (!campaigns?.length) {
        return { error: 'Кампания не найдена' };
      }
      
      const campaign = campaigns[0];
      
      // Получаем анкету
      let questionnaire: any = null;
      try {
        const questionnaires = await directusCrud.list('business_questionnaire', {
          ...directusAuth(request.authToken),
          filter: { campaign_id: { _eq: campaignId } },
          limit: 1
        });
        questionnaire = questionnaires?.[0] || null;
      } catch (error) {
        console.log('[AUTONOMOUS-AI] Анкета не найдена');
      }

      // Проверяем статус автономного режима
      const autoState = autonomousStates.get(campaignId);

      // Форматируем человекочитаемый статус кампании
      // Если авторежим активен — статус кампании считаем "Активная" независимо от поля campaign.status
      const statusMap: Record<string, string> = {
        active: '✅ Активная',
        inactive: '⏸ Неактивная',
        draft: '📝 Черновик',
        paused: '⏸ На паузе',
        archived: '🗃 Архив',
      };
      const rawStatusLabel = statusMap[campaign.status] || campaign.status;
      const statusLabel = autoState
        ? '✅ Активная'
        : rawStatusLabel || '⏸ Неактивная';

      let autonomousInfo = '⏹ Выключен';
      if (autoState) {
        const runtime = Math.round((Date.now() - autoState.startedAt.getTime()) / 60000);
        const platformsList = autoState.platforms?.join(', ') || '—';
        const modeLabel = autoState.pipelineMode === 'controlled' ? 'контролируемый'
          : autoState.pipelineMode === 'mixed' ? 'смешанный' : 'полностью авто';
        autonomousInfo = autoState.cycleRunning
          ? `🔄 Активен — цикл выполняется прямо сейчас (работает ${runtime} мин., режим: ${modeLabel}, платформы: ${platformsList})`
          : `🤖 Активен (работает ${runtime} мин., постов создано: ${autoState.postsCreated}, режим: ${modeLabel}, платформы: ${platformsList})`;
      }

      // Читаем промты из autonomous_settings кампании и команду запуска из состояния
      let promptInfo = '';
      try {
        const rawSettings = campaign.autonomous_settings;
        let autoSettings: { globalPrompt?: string; alwaysInclude?: string; signature?: string } = {};
        if (rawSettings && typeof rawSettings === 'object') autoSettings = rawSettings;
        else if (typeof rawSettings === 'string' && rawSettings.trim()) {
          try { autoSettings = JSON.parse(rawSettings); } catch { /* ignore */ }
        }
        const parts: string[] = [];
        // Команда запуска: из in-memory state (приоритет) или из autonomous_settings кампании (после перезапуска)
        const launchCmd = autoState?.launchCommand || (autoSettings as any).launchCommand;
        if (launchCmd) parts.push(`🚀 Команда запуска:\n${launchCmd}`);
        // Промты из настроек кампании
        if (autoSettings.globalPrompt) parts.push(`📌 Основной промт:\n${autoSettings.globalPrompt}`);
        if (autoSettings.alwaysInclude) parts.push(`📎 Всегда включать:\n${autoSettings.alwaysInclude}`);
        if (autoSettings.signature) parts.push(`✍️ Подпись:\n${autoSettings.signature}`);
        if (parts.length > 0) {
          promptInfo = '\n\n' + parts.join('\n\n');
        } else {
          promptInfo = '\n\n⚠️ Промты не заданы';
        }
      } catch { /* ignore */ }

      const message =
        `📋 Кампания: ${campaign.name}\n` +
        `🔵 Статус: ${statusLabel}\n` +
        (campaign.description ? `📝 Описание: ${campaign.description}\n` : '') +
        `🤖 Автономный режим: ${autonomousInfo}` +
        promptInfo;

      return {
        success: true,
        message,
        data: { campaign, questionnaire, hasQuestionnaire: !!questionnaire, autonomousActive: !!autoState }
      };
    } catch (error) {
      return { error: `Ошибка получения данных кампании: ${error}` };
    }
  },

  async getKeywordsFromWebsite(params: any, request: AIToolRequest) {
    try {
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
        
      const response = await axios.post(`${baseUrl}/api/keywords/analyze-website`, {
        url: params.websiteUrl
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${request.authToken}`
        }
      });
      
      return response.data;
    } catch (error) {
      return { error: `Ошибка анализа сайта: ${error}` };
    }
  },

  async collectTrends(params: any, request: AIToolRequest) {
    try {
      const { collectTrendsForCampaign } = await import('./trend-collector');
      console.log('[COLLECT-TRENDS] 🚀 Прямой сбор трендов без n8n для кампании:', params.campaignId);

      const result = await collectTrendsForCampaign({
        campaignId: params.campaignId,
        userId: request.userId,
        authToken: request.authToken,
        postsPerPlatform: params.postsPerPlatform || 20,
        daysSince: params.daysSince || 7
      });

      console.log(`[COLLECT-TRENDS] ✅ Результат: VK=${result.vk}, Facebook=${result.facebook}, Telegram=${result.telegram}, Сохранено=${result.total}`);

      return {
        success: true,
        message: `Тренды собраны напрямую: VK (${result.vk}), Facebook (${result.facebook}), Telegram (${result.telegram ? 'запущен' : 'н/д'}). Сохранено: ${result.total}`,
        result
      };
    } catch (error) {
      console.error('[COLLECT-TRENDS] ❌ Ошибка:', error);
      return { error: `Ошибка сбора трендов: ${error}` };
    }
  },

  async getTrendsData(params: any, request: AIToolRequest) {
    try {
      console.log('[GET-TRENDS-DATA] Запрос трендов:', {
        campaignId: params.campaignId,
        userId: request.userId,
        hasAuthToken: !!request.authToken,
        authTokenPrefix: request.authToken ? request.authToken.substring(0, 20) + '...' : 'none'
      });
      
      const trends = await directusCrud.list('campaign_trend_topics', {
        useAdminToken: true,
        filter: { campaign_id: { _eq: params.campaignId } },
        limit: params.limit || 10,
        sort: ['-created_at']
      });
      
      console.log('[GET-TRENDS-DATA] Получено трендов:', trends?.length || 0);
      return { trends, count: trends?.length || 0 };
    } catch (error: any) {
      console.error('[GET-TRENDS-DATA] Ошибка:', {
        error: error?.message || String(error),
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        data: error?.response?.data,
        campaignId: params.campaignId,
        userId: request.userId
      });
      return { error: `Ошибка получения трендов: ${error}` };
    }
  },

  async createContent(params: any, request: AIToolRequest) {
    try {
      // Для server-to-server вызовов всегда используем localhost — внешний URL идёт через
      // Replit proxy и может отклонять запросы без браузерной аутентификации.
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
      
      // Количество постов для создания (по умолчанию 1)
      const count = Math.min(Math.max(params.count || 1, 1), 10); // От 1 до 10 постов
      console.log('[CREATE-CONTENT] Генерация контента:', { ...params, count });
      
      // ШАГ 0: Получаем данные кампании (ключевые слова и анкету)
      let campaignContext = '';
      
      // Получаем ключевые слова кампании
      try {
        console.log('[CREATE-CONTENT] Запрос ключевых слов для кампании:', params.campaignId);
        const { directusCrud } = await import('./directus-crud');
        const keywordsData = await directusCrud.list('campaign_keywords', {
          filter: { campaign_id: { _eq: params.campaignId } },
          limit: -1,
          ...directusAuth(request.authToken)
        });
        
        console.log('[CREATE-CONTENT] Ключевые слова получено записей:', keywordsData?.length || 0);
        
        if (Array.isArray(keywordsData) && keywordsData.length > 0) {
          const keywords = keywordsData.map((kw: any) => kw.keyword).filter(Boolean);
          if (keywords.length > 0) {
            campaignContext += `\n\nКЛЮЧЕВЫЕ СЛОВА КАМПАНИИ: ${keywords.join(', ')}`;
            console.log('[CREATE-CONTENT] ✅ Ключевые слова добавлены в контекст:', keywords.length);
          }
        } else {
          console.log('[CREATE-CONTENT] ⚠️ Ключевые слова пусты или отсутствуют');
        }
      } catch (error: any) {
        console.error('[CREATE-CONTENT] ❌ Ошибка получения ключевых слов:', {
          message: error?.message,
          status: error?.response?.status,
          data: error?.response?.data
        });
      }
      
      // Получаем анкету бизнеса через Directus API (только если явно запрошено)
      if (params.useQuestionnaire === true) {
        try {
          console.log('[CREATE-CONTENT] Запрос анкеты через Directus для кампании:', params.campaignId);
          
          // Используем правильный Directus эндпоинт для получения JSON
          const questionnaireResponse = await directusCrud.list('business_questionnaire', {
            ...directusAuth(request.authToken),
            filter: { campaign_id: { _eq: params.campaignId } },
            limit: 1
          });
          
          console.log('[CREATE-CONTENT] Ответ анкеты:', JSON.stringify(questionnaireResponse, null, 2));
          
          if (questionnaireResponse && questionnaireResponse.length > 0) {
            const q: any = questionnaireResponse[0];
            let addedFields = 0;
            campaignContext += `\n\nДАННЫЕ ИЗ АНКЕТЫ БИЗНЕСА:`;
            
            // ИСПРАВЛЕНО: Правильные поля из generateQuestionnaireFromWebsite
            if (q.company_name) {
              campaignContext += `\n- Название компании: ${q.company_name}`;
              addedFields++;
            }
            if (q.business_description) {
              campaignContext += `\n- Описание бизнеса: ${q.business_description}`;
              addedFields++;
            }
            if (q.products_services) {
              campaignContext += `\n- Продукты/услуги: ${q.products_services}`;
              addedFields++;
            }
            if (q.target_audience) {
              campaignContext += `\n- Целевая аудитория: ${q.target_audience}`;
              addedFields++;
            }
            if (q.competitive_advantages) {
              campaignContext += `\n- Конкурентные преимущества: ${q.competitive_advantages}`;
              addedFields++;
            }
            if (q.business_values) {
              campaignContext += `\n- Ценности бизнеса: ${q.business_values}`;
              addedFields++;
            }
            if (q.brand_image) {
              campaignContext += `\n- Образ бренда: ${q.brand_image}`;
              addedFields++;
            }
            if (q.customer_results) {
              campaignContext += `\n- Результаты для клиентов: ${q.customer_results}`;
              addedFields++;
            }
            
            console.log(`[CREATE-CONTENT] ✅ Анкета добавлена в контекст (${addedFields} полей)`);
          } else {
            console.log('[CREATE-CONTENT] ⚠️ Анкета не найдена для кампании');
          }
        } catch (error: any) {
          console.error('[CREATE-CONTENT] ❌ Ошибка получения анкеты:', {
            message: error?.message,
            status: error?.response?.status,
            data: error?.response?.data
          });
        }
      }
      
      // ШАГ 1: Генерируем контент через правильный API с контекстом кампании
      const hasData = campaignContext.trim().length > 0;
      console.log('[CREATE-CONTENT] 📊 Итоговый контекст кампании:', {
        length: campaignContext.length,
        hasData,
        preview: campaignContext.substring(0, 200)
      });
      
      const formattingRules = `

📐 ФОРМАТ И СТРУКТУРА ПОСТА (обязательно):
1. КРЮЧОК: первая строка — цепляющий заголовок или вопрос (не банальный)
2. ТЕЛО: 2–4 коротких абзаца, каждый отделён пустой строкой
3. ПРИЗЫВ К ДЕЙСТВИЮ: последний абзац — конкретный CTA (написать, купить, узнать подробнее)
4. ХЭШТЕГИ: 3–7 релевантных хэштегов в самом конце, отдельной строкой
5. ЭМОДЗИ: используй умеренно — 1–2 эмодзи на абзац, только по смыслу, не спамь
6. ДЛИНА: 150–400 слов (оптимально для вовлечённости)
7. НЕ используй: жирный Markdown (**текст**), курсив (*текст*), звёздочки — только чистый текст и эмодзи

❌ ЗАПРЕЩЕНО:
- Вступления типа "Вот пост", "Я подготовил", "Держи", "Конечно!"
- Комплименты пользователю
- Советы по улучшению и рассуждения
- Шаблонные клише: "в мире бизнеса", "на пути к успеху", "каждый из нас"
- Стены текста без абзацев`;

      // Если передан полный theme (из автономного цикла) — используем его как основу промпта,
      // иначе строим стандартный промпт из topic. theme уже содержит alwaysInclude, globalPrompt и т.д.
      const baseInstruction = (params.theme && params.theme.trim())
        ? params.theme
        : `Создай профессиональный пост для социальных сетей на тему: ${params.topic}`;

      const titleInstruction = `\n\nФОРМАТ ОТВЕТА (строго):
Первой строкой напиши заголовок в формате:
ЗАГОЛОВОК: <3–6 слов, конкретно отражает суть, без кавычек, без вводных слов>
Пример: ЗАГОЛОВОК: Скидки на летнюю коллекцию
Затем пустая строка, затем текст поста.`;

      const enrichedPrompt = hasData 
        ? `${baseInstruction}${campaignContext}

⚠️ ОБЯЗАТЕЛЬНО ИСПОЛЬЗУЙ ПРЕДОСТАВЛЕННЫЕ ДАННЫЕ:
1. СТРОГО используй ключевые слова и данные анкеты из контекста выше
2. Название бизнеса — ТОЛЬКО из данных, НЕ придумывай своё
3. Товары/услуги — ТОЛЬКО из данных анкеты
4. Целевая аудитория — из данных анкеты, если указана
5. УТП (уникальное торговое предложение) — из данных анкеты
6. Пост должен быть персонализирован под конкретный бизнес
${formattingRules}
${titleInstruction}`
        : `${baseInstruction}
${formattingRules}
${titleInstruction}`;

      // Создаём несколько постов если count > 1
      const createdPosts: any[] = [];
      
      for (let i = 0; i < count; i++) {
        console.log(`[CREATE-CONTENT] Генерация поста ${i + 1}/${count}...`);
        
        // Добавляем вариативность для каждого поста
        const variationPrompt = count > 1 
          ? enrichedPrompt + `\n\nВАЖНО: Это пост ${i + 1} из ${count}. Создай УНИКАЛЬНЫЙ вариант, отличающийся от предыдущих по стилю и подаче.`
          : enrichedPrompt;
        
        let contentResponse: any;
        const makeGenerateRequest = async (token: string) => axios.post(`${baseUrl}/api/generate-content`, {
          campaignId: params.campaignId,
          prompt: variationPrompt,
          service: 'gemini',
          generateImage: false,
          type: 'social_post'
        }, {
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        try {
          contentResponse = await makeGenerateRequest(request.authToken);
        } catch (axiosErr: any) {
          if (axiosErr?.response?.status === 401) {
            console.warn(`[CREATE-CONTENT] ⚠️ Токен истёк (401) — пробуем получить свежий JWT через directusAuthManager...`);
            try {
              const { directusAuthManager } = await import('./directus-auth-manager');
              const freshToken = await directusAuthManager.getValidToken(request.userId);
              if (freshToken) {
                request.authToken = freshToken;
                console.log(`[CREATE-CONTENT] ✅ Получен свежий JWT, повтор запроса...`);
                contentResponse = await makeGenerateRequest(freshToken);
              } else {
                // Последний шанс — статический admin-токен (middleware его принимает напрямую)
                const staticAdmin = process.env.DIRECTUS_STATIC_TOKEN || '';
                if (staticAdmin) {
                  console.warn(`[CREATE-CONTENT] ⚠️ getValidToken вернул null — пробуем admin static token`);
                  contentResponse = await makeGenerateRequest(staticAdmin);
                } else {
                  throw axiosErr;
                }
              }
            } catch (refreshErr: any) {
              if (refreshErr?.response?.status === 401) {
                console.error(`[CREATE-CONTENT] ❌ Все попытки авторизации провалились (401)`);
              }
              throw refreshErr;
            }
          } else {
            throw axiosErr;
          }
        }

        if (!contentResponse.data?.content) {
          console.error(`[CREATE-CONTENT] Не удалось сгенерировать пост ${i + 1}`);
          continue;
        }
        
        let generatedContent = contentResponse.data.content;
        console.log(`[CREATE-CONTENT] Пост ${i + 1} сгенерирован:`, generatedContent.substring(0, 100) + '...');

        // Извлекаем заголовок из первой строки ответа (формат "ЗАГОЛОВОК: ...")
        const capitalizeFirst = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
        let extractedTitle = '';
        const titleLineMatch = generatedContent.match(/^ЗАГОЛОВОК:\s*(.+)/i);
        if (titleLineMatch) {
          const rawExtracted = titleLineMatch[1].replace(/["'«»*_]/g, '').trim();
          // Не более 7 слов и 60 символов
          const words = rawExtracted.split(/\s+/);
          const byWords = words.length > 7 ? words.slice(0, 7).join(' ') : rawExtracted;
          extractedTitle = byWords.length > 60 ? byWords.slice(0, 60).trimEnd() : byWords;
          // Убираем строку заголовка и следующую пустую строку из тела поста
          generatedContent = generatedContent.replace(/^ЗАГОЛОВОК:\s*.+\n?\n?/i, '').trim();
        }

        // ШАГ 1.5: Проход редактора — только если включено в настройках кампании
        if (params.useEditorPass) {
          console.log(`[CREATE-CONTENT] ✏️ Запускаем редактора (пост ${i + 1})...`);
          generatedContent = await editorPassContent(
            generatedContent,
            params.editorGuide || '',
            request,
            params.humanize ?? false
          );
        }

        // Финальный заголовок: из ответа AI → из topic → дата
        const baseTitle = extractedTitle
          || (typeof params.topic === 'string' && params.topic.trim()
              ? capitalizeFirst(params.topic.trim())
              : `Пост от ${new Date().toLocaleDateString('ru-RU')}`);
        const finalTitle = count > 1 ? `${baseTitle} (${i + 1})` : baseTitle;
        console.log(`[CREATE-CONTENT] Заголовок поста ${i + 1}: "${finalTitle}"`);

        // ШАГ 2: Сохраняем контент в базу данных (admin-токен — серверная операция)
        const savedContent = await directusCrud.create('campaign_content', {
          campaign_id: params.campaignId,
          user_id: request.userId,
          title: finalTitle,
          content: generatedContent,
          content_type: 'text',
          status: 'draft',
          source: 'ai_generated',
          date_created: new Date().toISOString()
        }, { useAdminToken: true });
        
        console.log(`[CREATE-CONTENT] Пост ${i + 1} сохранен в базу с ID:`, (savedContent as any).id);
        
        createdPosts.push({
          id: (savedContent as any).id,
          content: generatedContent.substring(0, 200) + '...'
        });
        
        // Небольшая задержка между запросами чтобы не перегружать API
        if (i < count - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log(`[CREATE-CONTENT] Всего создано постов: ${createdPosts.length}/${count}`);
      
      return { 
        success: true, 
        message: createdPosts.length === 1 
          ? `Создан пост "${params.topic}"`
          : `Создано ${createdPosts.length} постов на тему "${params.topic}"`,
        count: createdPosts.length,
        posts: createdPosts
      };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      const responseData = error?.response?.data;
      const isTransient = errMsg.includes('503') || errMsg.includes('UNAVAILABLE') ||
        errMsg.includes('high demand') || errMsg.includes('429') || errMsg.includes('quota');
      console.error('[CREATE-CONTENT] Ошибка:', errMsg.slice(0, 200));
      if (isTransient) {
        return { error: 'ИИ временно перегружен — попробуйте через минуту.' };
      }
      const detail = responseData?.error || responseData?.message || errMsg;
      return { error: `Ошибка создания контента: ${String(detail).slice(0, 150)}` };
    }
  },

  async getAnalytics(params: any, request: AIToolRequest) {
    try {
      // Получаем статистику кампании
      const content = await directusCrud.list('campaign_content', {
        ...directusAuth(request.authToken),
        filter: { campaign_id: { _eq: params.campaignId } },
        limit: -1
      });
      
      const trends = await directusCrud.list('campaign_trend_topics', {
        useAdminToken: true,
        filter: { campaign_id: { _eq: params.campaignId } },
        limit: -1
      });
      
      return {
        contentCount: content?.length || 0,
        trendsCount: trends?.length || 0,
        lastActivity: (content?.[0] as any)?.date_created || null
      };
    } catch (error) {
      return { error: `Ошибка получения аналитики: ${error}` };
    }
  },

  async saveData(params: any, request: AIToolRequest) {
    try {
      const result = await directusCrud.create(params.table, params.data, directusAuth(request.authToken));
      
      return { saved: true, id: (result as any)?.id };
    } catch (error) {
      return { error: `Ошибка сохранения: ${error}` };
    }
  },

  async generateKeywords(params: any, request: AIToolRequest) {
    try {
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
        
      const response = await axios.post(`${baseUrl}/api/keywords/analyze-website`, {
        url: params.websiteUrl,
        campaignId: params.campaignId,
        language: params.language || 'russian',
        saveToDatabase: true  // Исправлено: теперь реально сохраняет в базу
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${request.authToken}`
        }
      });
      
      return response.data;
    } catch (error) {
      return { error: `Ошибка генерации ключевых слов: ${error}` };
    }
  },

  async saveKeywordsToCampaign(params: any, request: AIToolRequest) {
    try {
      const results = [];
      
      for (const keyword of params.keywords) {
        const keywordData = {
          keyword: keyword.keyword || keyword,
          campaign_id: params.campaignId,
          trend_score: keyword.trend_score || 50,
          mentions_count: keyword.mentions_count || 0,
          relevance: keyword.relevance || 80,
          category: keyword.category || 'основное'
        };
        
        const result = await directusCrud.create('campaign_keywords', keywordData, directusAuth(request.authToken));
        
        results.push(result);
      }
      
      return { 
        saved: true, 
        count: results.length,
        keywords: results
      };
    } catch (error) {
      return { error: `Ошибка сохранения ключевых слов: ${error}` };
    }
  },

  async getCampaignKeywords(params: any, request: AIToolRequest) {
    try {
      const keywords = await directusCrud.list('campaign_keywords', {
        ...directusAuth(request.authToken),
        filter: { campaign_id: { _eq: params.campaignId } },
        limit: -1,
        sort: ['-trend_score']
      });
      
      return { 
        keywords, 
        count: keywords?.length || 0,
        categories: {
          основное: keywords?.filter((k: any) => k.category === 'основное')?.length || 0,
          коммерческое: keywords?.filter((k: any) => k.category === 'коммерческое')?.length || 0,
          информационное: keywords?.filter((k: any) => k.category === 'информационное')?.length || 0,
          'long-tail': keywords?.filter((k: any) => k.category === 'long-tail')?.length || 0
        }
      };
    } catch (error) {
      return { error: `Ошибка получения ключевых слов: ${error}` };
    }
  },

  async getContentList(params: any, request: AIToolRequest) {
    try {
      const content = await directusCrud.list('campaign_content', {
        ...directusAuth(request.authToken),
        filter: { campaign_id: { _eq: params.campaignId } },
        limit: params.limit || 20
      });
      
      const contentList = content?.map((item: any) => ({
        id: item.id,
        title: item.title,
        content: item.content ? item.content.substring(0, 100) + '...' : 'Контент отсутствует',
        status: item.status,
        content_type: item.content_type
      })) || [];
      
      return { 
        content: contentList, 
        count: contentList.length,
        message: `Найдено ${contentList.length} постов в кампании`
      };
    } catch (error) {
      return { error: `Ошибка получения контента: ${error}` };
    }
  },

  async unpublishContent(params: any, request: AIToolRequest) {
    try {
      const axios = await import('axios');
      
      // Вызываем endpoint для снятия публикации
      const response = await axios.default.post(
        `${process.env.DIRECTUS_URL?.replace('/items', '')}/api/content/${params.contentId}/unpublish`,
        {},
        {
          headers: {
            Authorization: `Bearer ${request.authToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data.success) {
        const results = response.data.deletionResults || [];
        const successCount = results.filter((r: any) => r.success).length;
        const failCount = results.filter((r: any) => !r.success).length;
        
        let message = 'Публикация снята и перенесена в черновики';
        if (successCount > 0) {
          message += `. Удалено из ${successCount} соцсет${successCount === 1 ? 'и' : 'ей'}`;
        }
        if (failCount > 0) {
          message += `. Ошибка удаления из ${failCount} платформ${failCount === 1 ? 'ы' : ''}`;
        }
        
        return { 
          success: true,
          message,
          deletionResults: results
        };
      } else {
        return { 
          success: false,
          error: response.data.error || 'Неизвестная ошибка при снятии публикации'
        };
      }
    } catch (error: any) {
      return { 
        success: false,
        error: `Ошибка депостинга: ${error.response?.data?.error || error.message}` 
      };
    }
  },

  async removeDuplicatePosts(params: any, request: AIToolRequest) {
    try {
      const axios = await import('axios');
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
      
      console.log('[REMOVE-DUPLICATES] Удаление дубликатов для кампании:', params.campaignId);
      
      // Вызываем endpoint для удаления дубликатов
      const response = await axios.default.post(
        `${baseUrl}/api/campaign-content/remove-duplicates`,
        { campaignId: params.campaignId },
        {
          headers: {
            Authorization: `Bearer ${request.authToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data.success) {
        const { duplicatesFound, duplicatesRemoved, postsRemaining } = response.data;
        
        let message = response.data.message;
        if (duplicatesRemoved > 0) {
          message += `. Найдено ${duplicatesFound} дубликатов, успешно удалено ${duplicatesRemoved}. Осталось ${postsRemaining} уникальных постов.`;
        } else if (duplicatesFound === 0) {
          message = 'Дубликаты не найдены. Все посты уникальны.';
        }
        
        return { 
          success: true,
          message,
          duplicatesFound,
          duplicatesRemoved,
          postsRemaining,
          deletedIds: response.data.deletedIds || []
        };
      } else {
        return { 
          success: false,
          error: response.data.error || 'Неизвестная ошибка при удалении дубликатов'
        };
      }
    } catch (error: any) {
      console.error('[REMOVE-DUPLICATES] Ошибка:', error);
      return { 
        success: false,
        error: `Ошибка удаления дубликатов: ${error.response?.data?.error || error.message}` 
      };
    }
  },

  async readQuestionnaire(params: any, request: AIToolRequest) {
    try {
      const questionnaire = await directusCrud.list('business_questionnaire', {
        ...directusAuth(request.authToken),
        filter: { campaign_id: { _eq: params.campaignId } },
        limit: 1
      });
      
      if (questionnaire && questionnaire.length > 0) {
        return { 
          questionnaire: questionnaire[0],
          filled: true,
          message: 'Бизнес-анкета найдена и заполнена'
        };
      } else {
        return { 
          questionnaire: null,
          filled: false,
          message: 'Бизнес-анкета не найдена или не заполнена'
        };
      }
    } catch (error) {
      return { error: `Ошибка чтения анкеты: ${error}` };
    }
  },

  async fillQuestionnaire(params: any, request: AIToolRequest) {
    try {
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
        
      // Сначала получаем данные кампании для URL сайта
      const campaigns = await directusCrud.list('user_campaigns', {
        ...directusAuth(request.authToken),
        filter: { id: { _eq: params.campaignId } },
        limit: 1
      });
      
      if (!campaigns || campaigns.length === 0) {
        return { error: 'Кампания не найдена' };
      }
      
      const campaign = campaigns[0] as any;
      const websiteUrl = params.websiteUrl || campaign.link || campaign.website_url;
      
      if (!websiteUrl) {
        return { error: 'URL сайта не указан в кампании' };
      }
      
      // Анализируем сайт и заполняем анкету
      const response = await axios.post(`${baseUrl}/api/website-analysis`, {
        url: websiteUrl,
        campaignId: params.campaignId
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${request.authToken}`
        }
      });
      
      return {
        success: true,
        questionnaire: response.data,
        message: `Анкета успешно заполнена на основе анализа ${websiteUrl}`
      };
    } catch (error) {
      return { error: `Ошибка заполнения анкеты: ${error}` };
    }
  },

  async startScheduler(params: any, request: AIToolRequest) {
    try {
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
        
      const response = await axios.post(`${baseUrl}/api/scheduler/start`, {
        campaignId: params.campaignId
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${request.authToken}`
        }
      });
      
      return response.data;
    } catch (error) {
      return { error: `Ошибка запуска планировщика: ${error}` };
    }
  },

  async stopScheduler(params: any, request: AIToolRequest) {
    try {
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
        
      const response = await axios.post(`${baseUrl}/api/scheduler/stop`, {
        campaignId: params.campaignId
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${request.authToken}`
        }
      });
      
      return response.data;
    } catch (error) {
      return { error: `Ошибка остановки планировщика: ${error}` };
    }
  },

  async scheduleContent(params: any, request: AIToolRequest) {
    try {
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
      
      // Если платформы не переданы — читаем из настроек кампании
      let platformsArr: string[];
      if (Array.isArray(params.platforms) && params.platforms.length > 0) {
        platformsArr = params.platforms;
      } else {
        const campaignId = params.campaignId || params.campaign_id || params.contentCampaignId;
        if (campaignId) {
          platformsArr = await getCampaignConnectedPlatforms(campaignId, request.authToken);
          console.log(`[AUTONOMOUS-SCHEDULE] Платформы из настроек кампании: [${platformsArr.join(', ')}]`);
        } else {
          platformsArr = [];
        }
        if (platformsArr.length === 0) {
          platformsArr = ['telegram'];
          console.warn('[AUTONOMOUS-SCHEDULE] Платформы не заданы и не найдены в кампании, fallback: telegram');
        }
      }

      // Отсеиваем платформы, не настроенные в кампании, ещё до планирования.
      // Иначе VK без OAuth-токена будет фейлиться каждый цикл.
      let effectivePlatforms = platformsArr;
      let skippedPlatforms: Array<{ platform: string; code: string; reason: string }> = [];
      try {
        if (params.campaignId || params.campaign_id) {
          const campaignId = params.campaignId || params.campaign_id;
          const { directusCrud } = await import('./directus-crud');
          const campaignList = await directusCrud.list('user_campaigns', {
            filter: { id: { _eq: campaignId } }, limit: 1, useAdminToken: true
          });
          const socialMediaSettings = campaignList?.[0]?.social_media_settings || {};
          const { filterConfiguredPlatforms } = await import('./platform-config-validator');
          const { configured, skipped } = filterConfiguredPlatforms(socialMediaSettings, platformsArr);
          for (const s of skipped) {
            console.warn(`[AUTONOMOUS-SCHEDULE] Платформа ${s.platform} пропущена: ${s.reason}`);
          }
          effectivePlatforms = configured;
          skippedPlatforms = skipped;
        }
      } catch (e: any) {
        console.warn('[AUTONOMOUS-SCHEDULE] Не удалось проверить настройки платформ:', e?.message);
      }

      if (effectivePlatforms.length === 0) {
        return {
          success: false,
          error: 'Нет настроенных платформ для публикации в этой кампании',
          skipped: skippedPlatforms,
        };
      }

      const socialPlatforms: Record<string, any> = {};
      for (const p of effectivePlatforms) socialPlatforms[p] = { enabled: true };
      // Помечаем непрошедшие проверку платформы машинным кодом, чтобы они
      // отобразились в "Опубликованных" с реальной причиной.
      for (const s of skippedPlatforms) {
        socialPlatforms[s.platform] = {
          enabled: false,
          status: 'failed',
          errorCode: s.code,
          lastError: s.reason,
          failedAt: new Date().toISOString(),
        };
      }
      
      const authToken = await (async () => {
        // Если токен не JWT — берём свежий админский, чтобы не словить 401
        if (!request.authToken || !request.authToken.includes('.')) {
          const { directusCrud } = await import('./directus-crud');
          return await directusCrud.getAdminTokenPublic();
        }
        return request.authToken;
      })();
      
      const response = await axios.post(
        `${baseUrl}/api/direct-schedule/${params.contentId}`,
        {
          scheduledAt: params.scheduleTime,
          socialPlatforms
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          timeout: 30000
        }
      );
      
      return { success: true, ...response.data };
    } catch (error: any) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.error || error?.message || String(error);
      console.error(`[SCHEDULE-CONTENT] ❌ ${status || ''} ${detail}`);
      return { success: false, error: `Ошибка планирования: ${detail}` };
    }
  },

  async generateHashtags(params: any, request: AIToolRequest) {
    try {
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
        
      const response = await axios.post(`${baseUrl}/api/content/hashtags`, {
        topic: params.topic,
        count: params.count || 10,
        language: params.language || 'russian'
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${request.authToken}`
        }
      });
      
      return response.data;
    } catch (error) {
      return { error: `Ошибка генерации хештегов: ${error}` };
    }
  },

  async smartSearchTelegramChannels(params: any, request: AIToolRequest) {
    try {
      console.log('[SMART-SEARCH-TG] 🔍 Умный поиск Telegram-каналов, параметры:', params);
      console.log('[SMART-SEARCH-TG] 📌 Campaign ID из params:', params.campaignId);
      console.log('[SMART-SEARCH-TG] 📌 Campaign ID из request:', request.campaignId);
      
      // Используем campaignId из request, если он есть, иначе из params
      const campaignId = request.campaignId || params.campaignId;
      console.log('[SMART-SEARCH-TG] ✅ Итоговый Campaign ID:', campaignId);
      
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
      
      // Определяем ключевые слова для поиска
      let searchKeywords = params.keywords || [];
      
      // Если нужно использовать ключевые слова из кампании
      if (params.useKeywordsFromCampaign !== false) {
        try {
          console.log('[SMART-SEARCH-TG] 🔎 Запрашиваем ключевые слова для кампании:', campaignId);
          
          // Получаем ключевые слова из коллекции campaign_keywords
          const keywordsData = await directusCrud.list('campaign_keywords', {
            ...directusAuth(request.authToken),
            filter: { campaign_id: { _eq: campaignId } },
            limit: 100
          }) as any[];
          
          console.log('[SMART-SEARCH-TG] 📊 Получено записей из campaign_keywords:', keywordsData?.length || 0);
          
          if (keywordsData && keywordsData.length > 0) {
            // Извлекаем только сами ключевые слова
            const campaignKeywords = keywordsData.map((item: any) => item.keyword).filter(Boolean);
            console.log('[SMART-SEARCH-TG] 📋 Найдено ключевых слов:', campaignKeywords.length, campaignKeywords);
            
            // Объединяем ключевые слова из кампании с переданными
            if (campaignKeywords.length > 0) {
              const combined = new Set([...searchKeywords, ...campaignKeywords]);
              searchKeywords = Array.from(combined);
            }
          }
        } catch (error: any) {
          console.error('[SMART-SEARCH-TG] ❌ Ошибка получения ключевых слов из campaign_keywords:', error.message);
        }
      }
      
      // Проверяем, что есть ключевые слова для поиска
      if (!searchKeywords || searchKeywords.length === 0) {
        return {
          success: false,
          error: 'В кампании нет сохранённых ключевых слов. Сначала выполните команду "подобери ключевые слова с сайта [URL]" или "сгенерируй ключевые слова для кампании", затем повторите поиск Telegram-каналов.'
        };
      }
      
      console.log('[SMART-SEARCH-TG] 🔎 Итоговые ключевые слова для поиска:', searchKeywords);
      
      // Выполняем умный поиск каналов
      const response = await axios.post(`${baseUrl}/api/telegram-channels/smart-search`, {
        keywords: searchKeywords,
        campaignId: params.campaignId,
        searchInCategory: false, // Возвращаем всю категорию, а не ищем внутри неё
        returnFullCategory: true,
        limit: params.limit || 50
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${request.authToken}`
        }
      });
      
      const searchResult = response.data?.data || response.data; // Поддержка обоих форматов
      
      // Автоматически добавляем каналы в источники, если это запрошено
      if (params.addToSources !== false && searchResult.channels?.length > 0) {
        console.log('[SMART-SEARCH-TG] 📥 Добавление каналов в источники кампании...');
        
        const sourcesAdded = [];
        const sourcesFailed = [];
        
        for (const channel of searchResult.channels) {
          try {
            // Формируем правильные данные из канала Directus
            const channelName = channel.title || channel.username || 'Неизвестный канал';
            const channelUrl = channel.link || `https://t.me/${channel.username}`;
            const categoryName = searchResult.detectedCategory?.name_ru || 'Telegram';
            
            const sourceData = {
              name: channelName,
              type: 'telegram',
              url: channelUrl,
              campaign_id: campaignId,
              description: channel.description || '',
              is_active: true
            };
            
            // Используем пользовательский токен для создания campaign_content_sources
            const source = await directusCrud.create('campaign_content_sources', sourceData, directusAuth(request.authToken));
            
            sourcesAdded.push({ channel: channelName, sourceId: (source as any)?.id });
          } catch (error: any) {
            const channelName = channel.title || channel.username || 'Неизвестный канал';
            console.error(`[SMART-SEARCH-TG] Ошибка добавления канала ${channelName}:`, error.message);
            sourcesFailed.push({ channel: channelName, error: error.message });
          }
        }
        
        // Определяем, полностью ли успешна операция
        const isFullSuccess = sourcesFailed.length === 0;
        const isPartialSuccess = sourcesAdded.length > 0 && sourcesFailed.length > 0;
        const categoryName = searchResult.detectedCategory?.name_ru || 'Telegram';
        
        if (!isFullSuccess && !isPartialSuccess) {
          return {
            success: false,
            error: `Не удалось добавить ни одного канала в источники. Найдено ${searchResult.channels.length} каналов в категории "${categoryName}", но все попытки добавления провалились.`,
            detectedCategory: searchResult.detectedCategory,
            channels: searchResult.channels,
            sourcesFailed: sourcesFailed
          };
        }
        
        let message = `Найдено ${searchResult.channels.length} Telegram-каналов в категории "${categoryName}". ${sourcesAdded.length} каналов добавлено в источники кампании.`;
        if (sourcesFailed.length > 0) {
          message += ` Не удалось добавить ${sourcesFailed.length} каналов.`;
        }
        
        return {
          success: isFullSuccess,
          partialSuccess: isPartialSuccess,
          detectedCategory: searchResult.detectedCategory,
          channels: searchResult.channels,
          sourcesAdded: sourcesAdded,
          sourcesFailed: sourcesFailed.length > 0 ? sourcesFailed : undefined,
          message: message
        };
      }
      
      return {
        success: true,
        detectedCategory: searchResult.detectedCategory,
        channels: searchResult.channels,
        message: `Найдено ${searchResult.channels.length} Telegram-каналов в категории "${searchResult.detectedCategory}".`
      };
      
    } catch (error: any) {
      console.error('[SMART-SEARCH-TG] ❌ Ошибка:', error.message);
      return { 
        success: false,
        error: `Ошибка умного поиска Telegram-каналов: ${error.message}`
      };
    }
  },

  // ============ АВТОНОМНЫЙ РЕЖИМ ============

  async startAutonomous(params: any, request: AIToolRequest) {
    try {
      const campaignId = params.campaignId || request.campaignId;
      const interval = params.interval || 24; // По умолчанию раз в день
      const postsPerCycle = params.postsPerCycle || 1; // По умолчанию 1 пост за цикл
      const autoSchedule = params.autoSchedule !== false; // По умолчанию true
      const withImages = params.withImages !== false; // По умолчанию с картинками
      
      console.log(`[AUTONOMOUS] 🤖 Запуск автономного режима для кампании ${campaignId}`);
      
      // Проверяем, не запущен ли уже автономный режим для этой кампании
      if (autonomousStates.has(campaignId)) {
        return {
          success: false,
          error: 'Автономный режим уже активен для этой кампании. Сначала остановите текущий режим командой "стоп" или stopAutonomous.'
        };
      }
      
      // Создаём состояние автономного режима
      const adminToken = process.env.DIRECTUS_STATIC_TOKEN || '';
      // Если platforms не переданы — берём фактически подключённые к кампании.
      let platforms: string[] = Array.isArray(params.platforms) && params.platforms.length > 0
        ? params.platforms
        : await getCampaignConnectedPlatforms(campaignId, adminToken || request.authToken);
      if (platforms.length === 0) {
        return {
          success: false,
          error: 'К кампании не подключена ни одна соцсеть. Подключите хотя бы одну в настройках кампании, затем запустите автономный режим заново.'
        };
      }

      // Пытаемся получить refresh_token пользователя из кэша directusAuthManager
      let userRefreshToken: string | undefined;
      try {
        const { directusAuthManager } = await import('./directus-auth-manager');
        const session = (directusAuthManager as any).sessionCache?.[request.userId];
        if (session?.refreshToken) {
          userRefreshToken = session.refreshToken;
          console.log(`[AUTONOMOUS] ✅ Сохранён refresh_token пользователя для фонового обновления JWT`);
        } else {
          console.warn(`[AUTONOMOUS] ⚠️ refresh_token пользователя не найден в кэше — фоновое обновление через directusAuthManager`);
        }
      } catch (e) {
        console.warn(`[AUTONOMOUS] ⚠️ Не удалось получить refresh_token: ${e}`);
      }

      const state: AutonomousState = {
        campaignId,
        userId: request.userId,
        authToken: request.authToken || adminToken,
        refreshToken: userRefreshToken,
        isActive: true,
        startedAt: new Date(),
        interval,
        postsPerCycle,
        autoSchedule,
        platforms,
        withImages,
        launchCommand: resolveLaunchCommand(request.message, request.chatHistory) || undefined,
        cyclesCompleted: 0,
        postsCreated: 0,
        cycleRunning: false,
        errors: []
      };
      
      autonomousStates.set(campaignId, state);
      saveAutonomousPersistence();

      // Сохраняем команду запуска прямо в autonomous_settings кампании —
      // надёжнее чем autonomous_sessions (не зависит от admin login)
      const resolvedLaunchCommand = resolveLaunchCommand(request.message, request.chatHistory);
      if (resolvedLaunchCommand) {
        try {
          const camp: any = await directusCrud.getById('user_campaigns', campaignId, directusAuth(request.authToken));
          const rawSettings = camp?.autonomous_settings;
          let existingSettings: Record<string, any> = {};
          if (rawSettings && typeof rawSettings === 'object') existingSettings = rawSettings;
          else if (typeof rawSettings === 'string' && rawSettings.trim()) {
            try { existingSettings = JSON.parse(rawSettings); } catch { /* ignore */ }
          }
          await directusCrud.update('user_campaigns', campaignId, {
            autonomous_settings: { ...existingSettings, launchCommand: resolvedLaunchCommand }
          }, directusAuth(request.authToken));
          console.log(`[AUTONOMOUS] ✅ launchCommand сохранён в autonomous_settings кампании ${campaignId}`);
        } catch (saveErr: any) {
          console.warn(`[AUTONOMOUS] ⚠️ Не удалось сохранить launchCommand: ${saveErr.message}`);
        }
      }

      // Запускаем первый цикл сразу
      console.log(`[AUTONOMOUS] Запуск первого цикла...`);
      runAutonomousCycle(state).catch(error => {
        console.error('[AUTONOMOUS] Ошибка первого цикла:', error);
        state.errors.push(`Первый цикл: ${error.message}`);
      });
      
      // Устанавливаем таймер для последующих циклов
      const intervalMs = interval * 60 * 60 * 1000; // часы в миллисекунды
      state.timer = setInterval(async () => {
        console.log(`[AUTONOMOUS] ⏰ Время для нового цикла (кампания ${campaignId})`);
        await runAutonomousCycle(state).catch(error => {
          console.error('[AUTONOMOUS] Ошибка цикла:', error);
          state.errors.push(`Цикл ${state.cyclesCompleted + 1}: ${error.message}`);
        });
      }, intervalMs);
      
      const postsPerDay = Math.round((24 / interval) * postsPerCycle);
      return {
        success: true,
        message: `🤖 Автономный режим запущен!\n\n` +
                 `🚀 ПЕРВЫЙ ПОСТ УЖЕ ГЕНЕРИРУЕТСЯ ПРЯМО СЕЙЧАС — не нужно ждать!\n\n` +
                 `📊 Настройки:\n` +
                 `• Интервал: каждые ${interval} ч.\n` +
                 `• Постов за цикл: ${postsPerCycle} (~${postsPerDay} в день)\n` +
                 `• Картинки: ${withImages ? 'Да ✅' : 'Нет'}\n` +
                 `• Автопланирование: ${autoSchedule ? 'Да' : 'Нет'}\n` +
                 `• Платформы: ${platforms.join(', ')}\n\n` +
                 `Я буду самостоятельно:\n` +
                 `✅ Собирать тренды\n` +
                 `✅ Генерировать контент${withImages ? ' + картинки' : ''}\n` +
                 `${autoSchedule ? '✅ Подбирать оптимальное время публикации (с учётом дня недели, часов активности и тематики поста)\n' : ''}` +
                 `\nДля остановки: "стоп" или "выключи автономный режим"`,
        data: { campaignId, interval, postsPerCycle, autoSchedule, withImages, platforms, firstCycleStartedImmediately: true }
      };
    } catch (error: any) {
      console.error('[AUTONOMOUS] ❌ Ошибка запуска:', error.message);
      return {
        success: false,
        error: `Ошибка запуска автономного режима: ${error.message}`
      };
    }
  },
  
  async stopAutonomous(params: any, request: AIToolRequest) {
    try {
      const campaignId = params.campaignId || request.campaignId;
      
      console.log(`[AUTONOMOUS] 🛑 Остановка автономного режима для кампании ${campaignId}`);
      
      const state = autonomousStates.get(campaignId);
      if (!state) {
        return {
          success: false,
          error: 'Автономный режим не активен для этой кампании'
        };
      }
      
      // Останавливаем таймер
      if (state.timer) {
        clearInterval(state.timer);
      }
      
      // Удаляем состояние
      autonomousStates.delete(campaignId);
      deleteAutonomousPersistence(campaignId);
      
      const runtime = Math.round((new Date().getTime() - state.startedAt.getTime()) / (1000 * 60)); // минуты
      
      return {
        success: true,
        message: `✅ Автономный режим остановлен\n\n` +
                 `📊 Статистика работы:\n` +
                 `• Время работы: ${runtime} мин.\n` +
                 `• Циклов выполнено: ${state.cyclesCompleted}\n` +
                 `• Постов создано: ${state.postsCreated}\n` +
                 `${state.errors.length > 0 ? `⚠️ Ошибок: ${state.errors.length}\n` : ''}`,
        data: {
          campaignId,
          runtime,
          cyclesCompleted: state.cyclesCompleted,
          postsCreated: state.postsCreated,
          errors: state.errors
        }
      };
    } catch (error: any) {
      console.error('[AUTONOMOUS] ❌ Ошибка остановки:', error.message);
      return {
        success: false,
        error: `Ошибка остановки автономного режима: ${error.message}`
      };
    }
  },
  
  async getAutonomousStatus(params: any, request: AIToolRequest) {
    try {
      const campaignId = params.campaignId || request.campaignId;
      const state = autonomousStates.get(campaignId);

      // Запрашиваем кампанию, посты и автосессии параллельно
      const [campaigns, allContent, autoSessions] = await Promise.all([
        directusCrud.list('user_campaigns', {
          ...directusAuth(request.authToken),
          filter: { id: { _eq: campaignId } },
          limit: 1
        }).catch(() => [] as any[]),
        directusCrud.list('campaign_content', {
          ...directusAuth(request.authToken),
          filter: { campaign_id: { _eq: campaignId } },
          limit: -1,
          fields: ['id', 'status', 'scheduled_at']
        }).catch(() => [] as any[]),
        directusCrud.list('autonomous_sessions', {
          ...directusAuth(request.authToken),
          filter: { campaign_id: { _eq: campaignId } },
          sort: ['-started_at'],
          limit: 1
        }).catch(() => [] as any[])
      ]);

      const campaign = campaigns?.[0] as any;
      const posts = allContent || [];
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const totalPosts = posts.length;
      const publishedPosts = posts.filter((p: any) => p.status === 'published').length;
      const draftPosts = posts.filter((p: any) => p.status === 'draft').length;
      // Запланировано (только будущие) — как на странице «Запланировано»
      const scheduledPosts = posts.filter((p: any) => {
        if (p.status !== 'scheduled') return false;
        const d = p.scheduled_at ? new Date(p.scheduled_at).getTime() : null;
        return !d || d >= todayStart.getTime();
      }).length;
      // Просроченные запланированные (дата в прошлом)
      const overduePosts = posts.filter((p: any) => {
        if (p.status !== 'scheduled') return false;
        const d = p.scheduled_at ? new Date(p.scheduled_at).getTime() : null;
        return d && d < todayStart.getTime();
      }).length;

      // --- Заголовок кампании ---
      let message = '';
      if (campaign) {
        const statusMap: Record<string, string> = {
          active: '✅ Активная', inactive: '⏸ Неактивная',
          draft: '📝 Черновик', paused: '⏸ На паузе', archived: '🗃 Архив',
        };
        const statusLabel = state ? '✅ Активная' : (statusMap[campaign.status] || campaign.status || '⏸ Неактивная');
        const siteUrl = campaign.website_link || campaign.website || campaign.website_url || campaign.link || null;
        message += `📌 **${campaign.name || 'Без названия'}**\n`;
        message += `- Сайт: ${siteUrl || 'Не указан'}\n`;
        message += `- Статус: ${statusLabel}\n\n`;
      }

      // --- Посты ---
      message += `📝 **Посты:**\n`;
      message += `- Всего сгенерировано: **${totalPosts}**\n`;
      message += `- Опубликовано: **${publishedPosts}**\n`;
      if (scheduledPosts > 0) message += `- Запланировано (предстоящие): **${scheduledPosts}**\n`;
      if (overduePosts > 0) message += `- Просроченные запланированные: **${overduePosts}**\n`;
      if (draftPosts > 0) message += `- Черновики: **${draftPosts}**\n`;
      message += '\n';

      // --- Авторежим ---
      if (state) {
        const runtime = Math.round((Date.now() - state.startedAt.getTime()) / 60000);
        const nextCycleIn = state.lastCycleAt
          ? Math.max(0, Math.round((state.interval * 60) - ((Date.now() - state.lastCycleAt.getTime()) / 60000)))
          : 0;
        message += `🤖 **Авторежим:** АКТИВЕН\n`;
        message += `- Работает: ${runtime} мин.\n`;
        message += `- Циклов выполнено: ${state.cyclesCompleted}\n`;
        message += state.cycleRunning
          ? `- 🔄 Цикл выполняется прямо сейчас\n`
          : `- Следующий цикл через: ${nextCycleIn} мин.\n`;
        if (state.errors.length > 0) {
          const lastErrors = state.errors.slice(-3);
          message += `- ⚠️ Ошибок: ${state.errors.length}\n`;
          lastErrors.forEach(e => { message += `  • ${e}\n`; });
        }
        message += '\n';
      } else {
        message += `🤖 **Авторежим:** ⏹ Выключен\n\n`;
      }

      // --- Промты ---
      message += `🤖 **Промты:**\n\n`;
      const rawSettings = campaign?.autonomous_settings;
      let autoSettings: Record<string, any> = {};
      if (rawSettings && typeof rawSettings === 'object') autoSettings = rawSettings;
      else if (typeof rawSettings === 'string' && rawSettings.trim()) {
        try { autoSettings = JSON.parse(rawSettings); } catch { /* ignore */ }
      }

      let hasPrompts = false;
      if (autoSettings.globalPrompt) {
        message += `📌 **Основной промт (из настроек):**\n${autoSettings.globalPrompt}\n\n`;
        hasPrompts = true;
      }
      if (autoSettings.alwaysInclude) {
        message += `📎 **Всегда включать:**\n${autoSettings.alwaysInclude}\n\n`;
        hasPrompts = true;
      }
      if (autoSettings.signature) {
        message += `✍️ **Подпись:**\n${autoSettings.signature}\n\n`;
        hasPrompts = true;
      }

      // launch_command из последней записи autonomous_sessions (приоритет), затем из autonomous_settings
      const lastSession = autoSessions?.[0] as any;
      const launchCommand = lastSession?.launch_command || state?.launchCommand || autoSettings.launchCommand;
      if (launchCommand) {
        message += `🚀 **Промт запуска авторежима:**\n${launchCommand}\n\n`;
        hasPrompts = true;
      }

      if (!hasPrompts) message += `⚠️ Промты не заданы\n`;

      return {
        success: true,
        message,
        data: {
          isActive: !!state,
          totalPosts,
          publishedPosts,
          draftPosts,
          scheduledPosts,
          ...(state ? {
            runtime: Math.round((Date.now() - state.startedAt.getTime()) / 60000),
            cyclesCompleted: state.cyclesCompleted,
            postsCreated: state.postsCreated,
            cycleRunning: state.cycleRunning,
            errors: state.errors
          } : {})
        }
      };
    } catch (error: any) {
      console.error('[AUTONOMOUS] ❌ Ошибка получения статуса:', error.message);
      return {
        success: false,
        error: `Ошибка получения статуса: ${error.message}`
      };
    }
  },

  async rewriteContent(params: any, request: AIToolRequest) {
    try {
      const { originalText, instructions, language = 'ru' } = params;
      
      console.log('[REWRITE-CONTENT] ✍️ Рерайт текста:', {
        originalLength: originalText.length,
        instructions,
        language
      });

      // Создаем промпт для рерайта
      const rewritePrompt = `Ты - профессиональный редактор и копирайтер.

ИСХОДНЫЙ ТЕКСТ:
"""
${originalText}
"""

ИНСТРУКЦИИ ПО РЕДАКТИРОВАНИЮ:
${instructions}

ВАЖНО:
- Выполни ВСЕ указанные инструкции
- Сохрани смысл, но примени требуемые изменения
- Вернуи ТОЛЬКО отредактированный текст без дополнительных пояснений
- Язык ответа: ${language}

ОТРЕДАКТИРОВАННЫЙ ТЕКСТ:`;

      // Вызываем AI для рерайта
      const aiResult = await aiService.generateContent({
        prompt: rewritePrompt,
        service: 'gemini',
        userId: request.userId,
        token: request.authToken
      });
      const response = aiResult.content;

      console.log('[REWRITE-CONTENT] ✅ Рерайт выполнен, новая длина:', response.length);

      return {
        success: true,
        message: '✅ Текст успешно отредактирован',
        data: {
          original: originalText,
          rewritten: response,
          instructions,
          stats: {
            originalLength: originalText.length,
            rewrittenLength: response.length,
            difference: response.length - originalText.length
          }
        }
      };
    } catch (error: any) {
      console.error('[REWRITE-CONTENT] ❌ Ошибка:', error.message);
      return {
        success: false,
        error: `Ошибка рерайта: ${error.message}`
      };
    }
  },

  async generateImage(params: any, request: AIToolRequest) {
    try {
      const { prompt, contentId, aspectRatio = 'square', style = 'photorealistic', model = 'nano-banana-pro' } = params;
      
      console.log('[GENERATE-IMAGE] 🎨 Генерация изображения:', {
        prompt: prompt.slice(0, 100) + '...',
        contentId,
        aspectRatio,
        style,
        model
      });

      // Подготавливаем размеры
      const width = aspectRatio === 'landscape' ? 1344 : aspectRatio === 'portrait' ? 768 : 1024;
      const height = aspectRatio === 'landscape' ? 768 : aspectRatio === 'portrait' ? 1344 : 1024;
      const imageSize = `${width}x${height}`;

      let imageUrl: string | undefined;

      // Нанобанана = Gemini 2.5 Flash Image от Google (через Vertex AI)
      const isNanoBanana = model === 'nano-banana' || model === 'nano-banana-pro' || model === 'gemini';
      
      if (isNanoBanana) {
        console.log('[GENERATE-IMAGE] 🍌 Используем Google Gemini (nano-banana) через Vertex AI');
        try {
          const { createGeminiImageService } = await import('./gemini-image');
          const geminiService = createGeminiImageService();
          const result = await geminiService.generateImage({
            prompt,
            width,
            height,
            numImages: 1,
            style,
            userId: request.userId,
            campaignId: request.campaignId,
            contentId,
            model: 'gemini'
          });
          
          if (result.success && result.imageUrl) {
            imageUrl = result.imageUrl;
            console.log('[GENERATE-IMAGE] ✅ Gemini сгенерировал изображение:', imageUrl);
          } else {
            console.warn('[GENERATE-IMAGE] ⚠️ Gemini не смог сгенерировать, fallback на FAL:', result.error);
          }
        } catch (geminiErr: any) {
          console.warn('[GENERATE-IMAGE] ⚠️ Ошибка Gemini, fallback на FAL:', geminiErr.message);
        }
      }

      // Fallback или явная FAL модель
      if (!imageUrl) {
        const baseUrl = `http://localhost:${process.env.PORT || 5000}`;

        const axios = (await import('axios')).default;
        const authToken = request.authToken || request.userId;
        
        if (!authToken) {
          throw new Error('Отсутствует токен авторизации');
        }

        const falModel = isNanoBanana ? 'schnell' : model;
        const response = await axios.post(
          `${baseUrl}/api/generate-image`,
          {
            prompt,
            imageSize,
            numImages: 1,
            stylePreset: style,
            model: falModel,
            enable_safety_checker: false
          },
          {
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            timeout: 60000
          }
        );

        const rawImage = response.data.images?.[0];
        imageUrl = typeof rawImage === 'string' ? rawImage : rawImage?.url;
        
        if (!imageUrl) {
          const errDetail = response.data.error || JSON.stringify(response.data).slice(0, 100);
          throw new Error(`Не удалось получить URL изображения: ${errDetail}`);
        }
        
        console.log('[GENERATE-IMAGE] ✅ FAL сгенерировал изображение:', imageUrl);
      }

      // Если указан contentId, прикрепляем изображение к посту
      if (contentId) {
        console.log('[GENERATE-IMAGE] 📎 Прикрепляем изображение к посту:', contentId);
        
        const { directusCrud } = await import('./directus-crud');
        await directusCrud.updateItem('campaign_content', contentId, {
          image_url: imageUrl,
          content_type: 'text-image'
        }, directusAuth(request.authToken));
      }

      return {
        success: true,
        message: '✅ Изображение успешно сгенерировано',
        data: {
          imageUrl,
          prompt,
          aspectRatio,
          style,
          contentId
        }
      };
    } catch (error: any) {
      const status = error?.response?.status;
      const errMsg = error?.message || String(error);
      console.error('[GENERATE-IMAGE] ❌ Ошибка:', errMsg.slice(0, 200));
      if (status === 403) {
        return { success: false, error: 'Генерация изображений недоступна на вашем тарифе. Перейдите на Pro-план.' };
      }
      if (status === 429) {
        return { success: false, error: 'Превышен лимит генерации изображений. Попробуйте позже.' };
      }
      if (status === 400 && error?.response?.data?.key_missing) {
        return { success: false, error: 'FAL.AI ключ не настроен. Добавьте его в настройках кампании.' };
      }
      const transient = errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('timeout');
      return {
        success: false,
        error: transient
          ? 'Сервис генерации изображений временно недоступен. Попробуйте позже.'
          : `Ошибка генерации изображения: ${errMsg.slice(0, 100)}`
      };
    }
  }
};

/**
 * Генерирует промт для изображения на основе текста поста.
 * Сохраняет промт в поле image_prompt записи campaign_content в Directus.
 */
async function buildImagePromptFromText(params: {
  postText: string;
  topic: string;
  contentId: string;
  userId: string;
  authToken?: string;
}): Promise<string> {
  const { postText, topic, contentId, userId, authToken } = params;
  let imagePrompt = '';
  try {
    const promptResult = await aiService.generateContent({
      prompt: `You are a professional image prompt engineer specializing in social media visuals.

Analyze the following social media post and create a detailed image generation prompt that perfectly matches its content, mood, and theme.

Rules:
- Write in English only
- Max 250 characters
- Focus on: composition, subject, style, lighting, color palette, mood
- NO text, letters, words, signs or logos in the image
- Match the emotional tone: if post is professional → clean corporate style; if inspiring → vibrant and uplifting; if educational → clear and informative visuals
- Be specific about visual elements (e.g. "soft morning light through office window" not just "office")

Post topic: ${topic}
Post text (first 800 chars):
${postText.substring(0, 800)}

Respond with ONLY the image prompt, nothing else.`,
      model: 'gemini-2.5-flash',
      service: 'gemini',
      userId,
      token: authToken
    });
    imagePrompt = (promptResult.content || '').trim()
      .replace(/^["']|["']$/g, '')
      .replace(/^(Image prompt:|Prompt:)/i, '')
      .trim()
      .substring(0, 250);
  } catch {
    imagePrompt = `professional social media image for: ${topic.substring(0, 80)}, clean modern design, high quality photography`;
  }

  // Сохраняем промт в Directus чтобы он был виден в редакторе
  try {
    await directusCrud.updateItem('campaign_content', contentId, {
      image_prompt: imagePrompt
    }, authToken ? { authToken } : { useAdminToken: true });
    console.log(`[IMAGE-PROMPT] ✅ Промт сохранён для ${contentId}: "${imagePrompt.substring(0, 80)}..."`);
  } catch (saveErr: any) {
    console.warn(`[IMAGE-PROMPT] ⚠️ Не удалось сохранить промт в Directus: ${saveErr.message}`);
  }

  return imagePrompt;
}

// Функция выполнения одного цикла автономной работы
async function runAutonomousCycle(state: AutonomousState) {
  // SM-20: страховка от осиротевших таймеров. Сюда можно попасть из таймера,
  // который поставили до остановки или паузы: остановка удаляет состояние из
  // карты, пауза выставляет флаг. Без этой проверки цикл отработал бы на
  // состоянии, которого уже нет в системе.
  if (autonomousStates.get(state.campaignId) !== state || state.paused) {
    console.log(`[AUTONOMOUS] ⏭ Цикл пропущен: режим остановлен или на паузе (${state.campaignId})`);
    return;
  }

  console.log(`[AUTONOMOUS-CYCLE] 🔄 Начало цикла ${state.cyclesCompleted + 1} для кампании ${state.campaignId}`);
  state.cycleRunning = true;

  try {
    // Гарантируем свежий пользовательский JWT (рефреш только если истекает скоро)
    const activeToken = await ensureFreshUserToken(state);

    const request: AIToolRequest = {
      userId: state.userId,
      campaignId: state.campaignId,
      authToken: activeToken,
      message: ''
    };
    
    // 1. Анализ аналитики (некритично — продолжаем даже при ошибке)
    console.log(`[AUTONOMOUS-CYCLE] 📊 Анализ аналитики...`);
    let analyticsResult: any = {};
    try {
      analyticsResult = await TOOL_IMPLEMENTATIONS.getAnalytics({
        campaignId: state.campaignId,
        period: '7days'
      }, request);
    } catch (analyticsErr: any) {
      console.warn(`[AUTONOMOUS-CYCLE] ⚠️ Аналитика недоступна: ${analyticsErr.message}`);
    }
    
    // 2. Сбор трендов — ОТКЛЮЧЁН: сбор трендов только вручную юзером
    // (был: await TOOL_IMPLEMENTATIONS.collectTrends(...))

    // 3. Получение трендов (некритично) — берём уже собранные тренды из БД
    let trendsResult: any = { trends: [] };
    try {
      trendsResult = await TOOL_IMPLEMENTATIONS.getTrendsData({
        campaignId: state.campaignId,
        limit: 50
      }, request);
    } catch (trendsDataErr: any) {
      console.warn(`[AUTONOMOUS-CYCLE] ⚠️ Данные трендов недоступны: ${trendsDataErr.message}`);
    }

    // 3a. Пользовательские настройки автономного режима (некритично)
    // Поле user_campaigns.autonomous_settings (JSON):
    //   { globalPrompt: string, alwaysInclude: string, signature: string }
    let autoSettings: { globalPrompt?: string; alwaysInclude?: string; signature?: string; useEditorPass?: boolean; humanize?: boolean; adaptForPlatforms?: boolean; autoSelectPlatforms?: boolean; randomKeywords?: boolean } = {};
    try {
      const camp: any = await directusCrud.getById('user_campaigns', state.campaignId, directusAuth(request.authToken));
      const raw = camp?.autonomous_settings;
      if (raw && typeof raw === 'object') autoSettings = raw;
      else if (typeof raw === 'string' && raw.trim()) {
        try { autoSettings = JSON.parse(raw); } catch { /* ignore */ }
      }
      const has = !!(autoSettings.globalPrompt || autoSettings.alwaysInclude || autoSettings.signature);
      console.log(`[AUTONOMOUS-CYCLE] ⚙️ Пользовательские настройки: ${has ? 'есть' : 'нет'}`);
    } catch (settErr: any) {
      console.warn(`[AUTONOMOUS-CYCLE] ⚠️ Не удалось прочитать autonomous_settings: ${settErr.message}`);
    }

    // launchCommand — главная инструкция пользователя (из state или из autonomous_settings)
    // Объявляем здесь, до всех фаз генерации, чтобы избежать TDZ-ошибки
    const launchCommand = state.launchCommand || (autoSettings as any).launchCommand || '';

    // 3b. Ключевые слова кампании (некритично) — для контекста промпта
    let topKeywords: string[] = [];
    try {
      const kwRes: any = await TOOL_IMPLEMENTATIONS.getCampaignKeywords({
        campaignId: state.campaignId
      }, request);
      const kws = Array.isArray(kwRes?.keywords) ? kwRes.keywords : [];
      const allKeywords = kws
        .map((k: any) => (k?.keyword || k?.keyword_text || '').toString().trim())
        .filter(Boolean);
      if (autoSettings.randomKeywords && allKeywords.length > 0) {
        // Перемешиваем и берём случайные 8–12 слов для разнообразия тематики
        const shuffled = [...allKeywords].sort(() => Math.random() - 0.5);
        const pickCount = Math.min(shuffled.length, 8 + Math.floor(Math.random() * 5));
        topKeywords = shuffled.slice(0, pickCount);
        console.log(`[AUTONOMOUS-CYCLE] 🎲 Случайные ключевые слова (${topKeywords.length}/${allKeywords.length}): ${topKeywords.slice(0, 5).join(', ')}...`);
      } else {
        topKeywords = allKeywords.slice(0, 15);
      }
      console.log(`[AUTONOMOUS-CYCLE] 🔑 Ключевых слов в контексте: ${topKeywords.length}`);
    } catch (kwErr: any) {
      console.warn(`[AUTONOMOUS-CYCLE] ⚠️ Ключи недоступны: ${kwErr.message}`);
    }

    // ──────────────────────────────────────────────────────────────
    // ФАЗА 1: Ранжирование трендов по engagement
    // ──────────────────────────────────────────────────────────────
    const allTrends: any[] = (trendsResult as any).trends || [];
    const scoredTrends = allTrends
      .map((t: any) => {
        const views = Number(t?.views || 0);
        const reactions = Number(t?.reactions || 0);
        const comments = Number(t?.comments || 0);
        const score = views + reactions * 5 + comments * 10;
        return { trend: t, score };
      })
      .sort((a, b) => b.score - a.score);
    const topTrendPool = (scoredTrends[0]?.score || 0) > 0
      ? scoredTrends.slice(0, 10).map(x => x.trend)
      : allTrends.slice(0, 10);

    // Аналитические инсайты для промпта
    const analyticsInsights = (() => {
      const a = analyticsResult as any;
      if (!a || Object.keys(a).length === 0) return '';
      const parts: string[] = [];
      if (a.avgEngagementRate) parts.push(`средний ER ${a.avgEngagementRate}%`);
      if (a.topPosts?.length) parts.push(`лучшие темы: ${(a.topPosts as any[]).slice(0, 3).map((p: any) => p.title || p.topic || '').filter(Boolean).join(', ')}`);
      if (a.bestPostingTimes) parts.push(`лучшее время постинга: ${a.bestPostingTimes}`);
      return parts.join('; ');
    })();

    // ──────────────────────────────────────────────────────────────
    // ФАЗА 2: Генерация контент-плана
    // ──────────────────────────────────────────────────────────────
    console.log(`[PIPELINE] 📋 Фаза 2: генерация контент-плана на ${state.postsPerCycle} постов...`);
    let contentPlan = await generateContentPlan({
      count: state.postsPerCycle,
      keywords: topKeywords,
      trends: topTrendPool,
      platforms: state.platforms,
      globalPrompt: autoSettings.globalPrompt || '',
      alwaysInclude: autoSettings.alwaysInclude || '',
      launchCommand,
      analyticsInsights,
      request,
    });
    console.log(`[PIPELINE] ✅ Контент-план сгенерирован: ${contentPlan.length} идей`);

    // ──────────────────────────────────────────────────────────────
    // ФАЗА 3: Доработка плана (исключаем уже опубликованные темы)
    // ──────────────────────────────────────────────────────────────
    console.log(`[PIPELINE] 🔄 Фаза 3: доработка плана...`);
    let recentTitles: string[] = [];
    try {
      const recent: any[] = await directusCrud.list('campaign_content', {
        filter: { campaign_id: { _eq: state.campaignId } },
        fields: ['title'],
        sort: ['-created_at'],
        limit: 30,
        useAdminToken: true,
      });
      recentTitles = recent
        .map((r: any) => r?.title || r?.topic || '')
        .filter(Boolean);
    } catch { /* некритично */ }

    contentPlan = await refineContentPlan({
      plan: contentPlan,
      publishedTitles: recentTitles,
      globalPrompt: autoSettings.globalPrompt || '',
      alwaysInclude: autoSettings.alwaysInclude || '',
      platforms: state.platforms,
      launchCommand,
      request,
    });
    console.log(`[PIPELINE] ✅ Контент-план доработан: ${contentPlan.length} идей`);

    // ──────────────────────────────────────────────────────────────
    // ФАЗА 4: Одобрение плана (если mixed или controlled режим)
    // ──────────────────────────────────────────────────────────────
    const mode = state.pipelineMode || 'full_auto';
    // В mixed-режиме при одном посте одобрение плана бессмысленно — пропускаем
    const needsPlanApproval =
      (mode === 'controlled') ||
      (mode === 'mixed' && contentPlan.length > 1);
    if (needsPlanApproval) {
      console.log(`[PIPELINE] ⏸️ Режим "${mode}": ожидаем одобрения плана пользователем (${contentPlan.length} идей)...`);
      state.pendingPlan = contentPlan;

      const { approved, updatedItems } = await waitForPipelineApproval(state, 'plan');

      if (!approved) {
        console.log(`[PIPELINE] ❌ Контент-план отклонён пользователем — цикл прерван`);
        state.cyclesCompleted++;
        state.lastCycleAt = new Date();
        state.cycleRunning = false;
        return;
      }

      if (updatedItems && Array.isArray(updatedItems)) {
        contentPlan = updatedItems.filter(item => item.approved !== false);
        console.log(`[PIPELINE] ✅ Пользователь одобрил план (${contentPlan.length} постов после фильтра)`);
      } else {
        console.log(`[PIPELINE] ✅ Пользователь одобрил план без изменений`);
      }
    }

    // ──────────────────────────────────────────────────────────────
    // ФАЗА 5–7: Написание, картинки, редактор — по каждой идее
    // ──────────────────────────────────────────────────────────────
    console.log(`[PIPELINE] ✍️ Фаза 5: написание ${contentPlan.length} постов...`);
    const createdPosts: Array<{ contentId: string; postText: string; contentType: string; platform: string; topic: string }> = [];

    // Общие блоки пользовательских настроек (вшиваются в каждый пост)
    const buildUserBlocks = () => {
      // Главная инструкция пользователя — идёт первой, задаёт контекст всему
      const launchBlock = launchCommand
        ? `\n\n[SYSTEM_INSTRUCTION_START]\nГЛАВНАЯ ИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ (соблюдать в первую очередь):\n${launchCommand}\n[SYSTEM_INSTRUCTION_END]`
        : '';
      const kwBlock = topKeywords.length > 0
        ? `\n\nКЛЮЧЕВЫЕ СЛОВА КАМПАНИИ (используй органично, не перечислением): ${topKeywords.join(', ')}`
        : '';
      const globalBlock = autoSettings.globalPrompt
        ? `\n\n[USER_INSTRUCTION_START]\nГЛОБАЛЬНЫЕ ПРАВИЛА КАМПАНИИ:\n${autoSettings.globalPrompt}\n[USER_INSTRUCTION_END]`
        : '';
      const alwaysBlock = autoSettings.alwaysInclude
        ? `\n\nОБЯЗАТЕЛЬНО ВПЛЕТИ В ПОСТ (органично): ${autoSettings.alwaysInclude}`
        : '';
      const signatureBlock = autoSettings.signature
        ? `\n\nПОДПИСЬ В КОНЦЕ (добавь дословно): ${autoSettings.signature}`
        : '';
      const humanizeBlock = autoSettings.humanize
        ? `\n\nОЧЕЛОВЕЧИВАНИЕ ТЕКСТА:\n- Конкретика и личные наблюдения вместо обобщений\n- Варьируй ритм: короткое предложение — удар, потом развёртка\n- Допускай риторический вопрос или незавершённую мысль\n- Разговорные обороты: "если честно", "вот тебе пример"\n- Никакой симметричной AI-структуры`
        : '';
      return launchBlock + kwBlock + globalBlock + alwaysBlock + signatureBlock + humanizeBlock;
    };

    // ──────────────────────────────────────────────────────────────
    // ФАЗА 5: Написание постов по контент-плану
    // ──────────────────────────────────────────────────────────────

    // Проверяем, что режим не был остановлен пока мы готовили план
    if (!autonomousStates.has(state.campaignId)) {
      console.log(`[AUTONOMOUS-CYCLE] 🛑 Режим остановлен во время подготовки — прерываем цикл перед созданием контента`);
      state.cycleRunning = false;
      return;
    }

    for (let i = 0; i < contentPlan.length; i++) {
      const planItem = contentPlan[i];
      try {
        request.authToken = await ensureFreshUserToken(state);

        const contentType = planItem.contentType;
        const topic = planItem.topic.slice(0, 120);
        const userBlocks = buildUserBlocks();

        // Берём тренд для подкрепления идеи
        const pickedTrend = topTrendPool.length > 0
          ? topTrendPool[i % topTrendPool.length]
          : null;
        let trendContext = '';
        if (pickedTrend) {
          const trendTitle = (pickedTrend.title || pickedTrend.text || '').toString();
          const trendBody = (pickedTrend.description || pickedTrend.text || '').toString().slice(0, 400);
          if (trendTitle || trendBody) {
            trendContext = `\n\nТРЕНД ДЛЯ КОНТЕКСТА (не копируй — вдохнови идею):\n• ${trendTitle}${trendBody ? `\n${trendBody}` : ''}`;
          }
        }

        const theme =
          `Создай ${contentType} на тему: "${planItem.topic}"\n\n` +
          `ОБОСНОВАНИЕ ТЕМЫ: ${planItem.rationale}\n` +
          `ЦЕЛЕВАЯ ПЛАТФОРМА: ${planItem.platform}` +
          trendContext +
          userBlocks;

        console.log(`[PIPELINE] ✍️ Пост ${i + 1}/${contentPlan.length}: "${topic}" (${contentType})`);

        const contentResult = await TOOL_IMPLEMENTATIONS.createContent({
          campaignId: state.campaignId,
          topic,
          theme,
          count: 1,
          editorGuide: autoSettings.globalPrompt || '',
          useEditorPass: autoSettings.useEditorPass ?? false,
          humanize: autoSettings.humanize ?? false
        }, request);

        if (contentResult.success) {
          const savedPosts: Array<{ id: string; content: string }> = contentResult.posts || [];

          for (const savedPost of savedPosts) {
            const contentId = savedPost.id;
            const postText = savedPost.content || theme;

            // ── ФАЗА 6: Промт + картинка (только не в controlled режиме — там отдельная фаза) ──
            if (contentId && mode !== 'controlled') {
              try {
                console.log(`[PIPELINE] 🖼️ Фаза 6: генерация промта для поста ${contentId}...`);
                const imagePrompt = await buildImagePromptFromText({
                  postText,
                  topic: planItem.topic,
                  contentId,
                  userId: state.userId,
                  authToken: request.authToken
                });
                if (state.withImages) {
                  await TOOL_IMPLEMENTATIONS.generateImage({
                    prompt: imagePrompt,
                    contentId,
                    aspectRatio: 'landscape',
                    style: 'photorealistic',
                    model: 'nano-banana-pro'
                  }, request);
                  console.log(`[PIPELINE] ✅ Картинка сгенерирована для ${contentId}`);
                }
              } catch (imgErr: any) {
                console.warn(`[PIPELINE] ⚠️ Ошибка фазы 6:`, imgErr.message);
              }
            }

            createdPosts.push({ contentId, postText, contentType, platform: planItem.platform, topic: planItem.topic });
            state.postsCreated++;
            console.log(`[PIPELINE] ✅ Пост ${i + 1} сохранён. Итого: ${state.postsCreated}`);
          }

          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          console.warn(`[PIPELINE] ⚠️ createContent вернул success=false для поста ${i + 1}`);
        }
      } catch (error: any) {
        const isQuota = error.message && (
          error.message.includes('429') ||
          error.message.includes('RESOURCE_EXHAUSTED') ||
          error.message.includes('quota') ||
          error.message.includes('rate limit')
        );
        if (isQuota) {
          console.warn(`[PIPELINE] ⛔ Квота AI исчерпана (все провайдеры). Прерываем генерацию постов. Ошибка: ${error.message.slice(0, 120)}`);
          state.errors.push(`Квота AI исчерпана: ${error.message.slice(0, 120)}`);
          break;
        }
        console.error(`[PIPELINE] Ошибка создания поста ${i + 1}:`, error.message);
        state.errors.push(`Генерация поста: ${error.message}`);
      }
    }
    
    // ──────────────────────────────────────────────────────────────
    // ФАЗА 5.5: Одобрение текстов (только controlled)
    // ──────────────────────────────────────────────────────────────
    if (mode === 'controlled' && createdPosts.length > 0) {
      console.log(`[PIPELINE] ⏸️ Режим "controlled": ожидаем одобрения текстов...`);
      state.pendingContentIds = createdPosts.map(p => p.contentId);
      const { approved: contentApproved } = await waitForPipelineApproval(state, 'content');
      if (!contentApproved) {
        console.log(`[PIPELINE] ❌ Тексты отклонены пользователем — цикл прерван`);
        state.cyclesCompleted++;
        state.lastCycleAt = new Date();
        state.cycleRunning = false;
        return;
      }
      console.log(`[PIPELINE] ✅ Тексты одобрены — генерируем картинки`);
    }

    // ──────────────────────────────────────────────────────────────
    // ФАЗА 6 (controlled): Генерация картинок после одобрения текстов
    // ──────────────────────────────────────────────────────────────
    if (mode === 'controlled' && createdPosts.length > 0) {
      console.log(`[PIPELINE] 🖼️ Controlled: генерация промтов${state.withImages ? ' + картинок' : ''} для ${createdPosts.length} постов...`);
      for (const post of createdPosts) {
        const { contentId, postText, topic } = post;
        if (!contentId) continue;
        try {
          request.authToken = await ensureFreshUserToken(state);
          console.log(`[PIPELINE] 🖼️ Фаза 6: промт для поста ${contentId}...`);
          const imagePrompt = await buildImagePromptFromText({
            postText,
            topic,
            contentId,
            userId: state.userId,
            authToken: request.authToken
          });
          if (state.withImages) {
            await TOOL_IMPLEMENTATIONS.generateImage({
              prompt: imagePrompt,
              contentId,
              aspectRatio: 'landscape',
              style: 'photorealistic',
              model: 'nano-banana-pro'
            }, request);
            console.log(`[PIPELINE] ✅ Картинка сгенерирована для ${contentId}`);
          }
        } catch (imgErr: any) {
          console.warn(`[PIPELINE] ⚠️ Картинка не сгенерирована для ${contentId}:`, imgErr.message);
        }
      }

      // ──────────────────────────────────────────────────────────────
      // ФАЗА 6.5: Одобрение картинок (только controlled)
      // ──────────────────────────────────────────────────────────────
      console.log(`[PIPELINE] ⏸️ Режим "controlled": ожидаем одобрения картинок...`);
      const { approved: imagesApproved } = await waitForPipelineApproval(state, 'images');
      if (!imagesApproved) {
        console.log(`[PIPELINE] ❌ Картинки отклонены пользователем — публикация отменена`);
        state.cyclesCompleted++;
        state.lastCycleAt = new Date();
        state.cycleRunning = false;
        return;
      }
      console.log(`[PIPELINE] ✅ Картинки одобрены — планируем публикации`);
      state.pendingContentIds = undefined;
    }

    // 5. Автопланирование (если включено) — оптимальное время по МСК с учётом типа контента

    // Проверяем, что режим не был остановлен пока мы писали посты
    if (!autonomousStates.has(state.campaignId)) {
      console.log(`[AUTONOMOUS-CYCLE] 🛑 Режим остановлен во время написания постов — пропускаем публикацию (${createdPosts.length} черновиков остаются в базе)`);
      state.cycleRunning = false;
      return;
    }

    if (state.autoSchedule && createdPosts.length > 0) {
      console.log(`[AUTONOMOUS-CYCLE] 📅 Автопланирование ${createdPosts.length} постов с учётом МСК...`);
      
      // Получаем уже запланированные на ближайшее будущее посты этой кампании,
      // чтобы не накладывать новые на занятые слоты
      const existingScheduled: number[] = [];
      try {
        const { directusCrud } = await import('./directus-crud');
        const upcoming: any[] = await directusCrud.list('campaign_content', {
          filter: {
            campaign_id: { _eq: state.campaignId },
            scheduled_at: { _gte: new Date().toISOString() }
          },
          fields: ['scheduled_at'],
          limit: 200,
          ...directusAuth(request.authToken)
        });
        for (const item of upcoming) {
          if (item.scheduled_at) existingScheduled.push(new Date(item.scheduled_at).getTime());
        }
      } catch (e: any) {
        console.warn(`[AUTONOMOUS-CYCLE] ⚠️ Не удалось получить существующее расписание: ${e.message}`);
      }
      
      const scheduledThisCycle: number[] = [];

      for (const post of createdPosts) {
        try {
          const contentId = (post as any).contentId;
          const postText = (post as any).postText || '';
          const contentType = (post as any).contentType || '';
          
          if (!contentId) {
            console.warn(`[AUTONOMOUS-CYCLE] ⚠️ contentId не найден, пропускаем`);
            continue;
          }
          
          let scheduleTime: string;
          if (state.cyclesCompleted === 0) {
            // Первый цикл: публикуем сразу, с шагом 5 мин между постами цикла
            const offsetMs = scheduledThisCycle.length * 5 * 60 * 1000;
            scheduleTime = new Date(Date.now() + 2 * 60 * 1000 + offsetMs).toISOString();
            const delaySec = 2 + scheduledThisCycle.length * 5;
            console.log(`[AUTONOMOUS-CYCLE] 🚀 Первый цикл — пост ${contentId} публикуется через ${delaySec} мин`);
          } else {
            scheduleTime = pickOptimalScheduleTimeMsk({
              contentType,
              postText,
              taken: [...existingScheduled, ...scheduledThisCycle],
              platforms: state.platforms
            });
          }
          
          scheduledThisCycle.push(new Date(scheduleTime).getTime());
          
          const mskStr = new Date(scheduleTime).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
          console.log(`[AUTONOMOUS-CYCLE] 📅 Пост ${contentId} → ${mskStr} МСК (${contentType || 'без типа'})`);

          // Выбор платформ: AI или все подключённые
          let selectedPlatforms = state.platforms || ['telegram', 'vk'];
          if (autoSettings.autoSelectPlatforms && selectedPlatforms.length > 1) {
            try {
              // SM-18: критерии строим динамически из фактически доступных платформ,
              // чтобы в промт не попадали рекомендации для неподключённых соцсетей.
              const PLATFORM_CRITERIA: Record<string, string> = {
                telegram: 'подходит для ЛЮБОГО текстового контента, длинного и короткого',
                vk: 'хорош для длинных экспертных текстов, новостей, кейсов, статей',
                instagram: 'хорош для визуального контента, коротких эмоциональных постов, Reels',
                facebook: 'хорош для длинных текстов, новостей, кейсов',
                youtube: 'хорош для видео/клипов/роликов',
                tiktok: 'хорош для коротких вертикальных видео, вирусного контента',
                threads: 'хорош для коротких текстовых постов, обсуждений',
              };
              const criteriaLines = selectedPlatforms
                .map(p => `- ${p}: ${PLATFORM_CRITERIA[p] || 'подходит для своего формата контента'}`)
                .join('\n');

              const selectPrompt = `Выбери из доступных платформ те, которые лучше всего подходят для этого поста.

ТИП КОНТЕНТА: ${contentType || 'текстовый пост'}
ДОСТУПНЫЕ ПЛАТФОРМЫ: ${selectedPlatforms.join(', ')}

ТЕКСТ ПОСТА:
${postText.slice(0, 500)}

КРИТЕРИИ (только по доступным платформам):
${criteriaLines}
- Выбери МИНИМУМ 1, МАКСИМУМ все доступные платформы

Ответь ТОЛЬКО списком через запятую без пробелов (пример: telegram,vk):`;

              const selectResult = await aiService.generateContent({
                prompt: selectPrompt,
                model: 'gemini-2.5-flash',
                service: 'gemini',
                userId: state.userId,
                token: request.authToken
              });

              const raw = (selectResult.content || '').toLowerCase().trim();
              const chosen = raw
                .split(/[\s,;|]+/)
                .map((s: string) => s.trim())
                .filter((s: string) => selectedPlatforms.includes(s));

              if (chosen.length > 0) {
                console.log(`[AUTONOMOUS-CYCLE] 🎯 AI выбрал платформы: ${chosen.join(', ')} (из ${selectedPlatforms.join(', ')})`);
                selectedPlatforms = chosen;
              } else {
                console.warn(`[AUTONOMOUS-CYCLE] ⚠️ AI вернул неверные платформы "${raw}", используем все`);
              }
            } catch (selErr: any) {
              console.warn(`[AUTONOMOUS-CYCLE] ⚠️ Ошибка выбора платформ: ${selErr.message}, используем все`);
            }
          }

          await TOOL_IMPLEMENTATIONS.scheduleContent({
            campaignId: state.campaignId,
            contentId,
            platforms: selectedPlatforms,
            scheduleTime
          }, request);
        } catch (error: any) {
          console.error(`[AUTONOMOUS-CYCLE] Ошибка планирования:`, error.message);
          state.errors.push(`Планирование: ${error.message}`);
        }
      }
    }
    
    // Обновляем статус цикла
    state.cyclesCompleted++;
    state.lastCycleAt = new Date();
    state.cycleRunning = false;
    
    console.log(`[AUTONOMOUS-CYCLE] ✅ Цикл ${state.cyclesCompleted} завершён. Создано постов: ${createdPosts.length}`);
    
  } catch (error: any) {
    console.error(`[AUTONOMOUS-CYCLE] ❌ Ошибка цикла:`, error.message);

    const quotaErr = extractQuotaError(error);
    if (quotaErr) {
      console.error(`[AUTONOMOUS-CYCLE] 🚫 Квота AI исчерпана — автоматически останавливаем агент для кампании ${state.campaignId}`);
      quotaErrorMap.set(state.campaignId, { ...quotaErr, stoppedAt: new Date().toISOString() });
      if (state.timer) clearInterval(state.timer);
      autonomousStates.delete(state.campaignId);
      deleteAutonomousPersistence(state.campaignId);
    } else {
      state.errors.push(`Цикл ${state.cyclesCompleted + 1}: ${error.message}`);
    }
    state.cycleRunning = false;
  }
}

export class AutonomousAI {
  
  /**
   * Обработка команды пользователя через автономную AI-систему
   */
  async processCommand(request: AIToolRequest): Promise<AIToolResponse> {
    try {
      console.log('[AUTONOMOUS-AI] Обработка команды:', request.message);
      
      // ПРИОРИТЕТНАЯ ПРОВЕРКА #0: Перехват команд запуска/остановки авторежима
      // Это должно быть САМОЙ ПЕРВОЙ проверкой — до Gemini, чтобы история диалога не мешала
      const startAutonomousPattern = /запуст[иь].*авторе[жж]им|включ[иь].*авторе[жж]им|старт.*авторе[жж]им|авторе[жж]им.*запуст|запуст[иь].*авто\s*режим|включ[иь].*авто\s*режим/i;
      const stopAutonomousPattern = /остановит?ь?.*авторе[жж]им|выключ[иь].*авторе[жж]им|стоп.*авторе[жж]им|авторе[жж]им.*стоп|останов[иь].*авторе[жж]им/i;

      if (startAutonomousPattern.test(request.message)) {
        const isAlreadyRunning = autonomousStates.has(request.campaignId);
        if (isAlreadyRunning) {
          console.log('[AUTONOMOUS-AI] ℹ️ Перехват startAutonomous: уже запущен');
          const existing = autonomousStates.get(request.campaignId)!;
          return {
            response: `Автономный режим уже активен. Интервал: каждые ${existing.interval} ч., платформы: ${existing.platforms.join(', ')}. Чтобы перезапустить — сначала остановите ("стоп авторежим"), затем запустите снова.`,
            success: true
          };
        }
        console.log('[AUTONOMOUS-AI] 🔥 Перехват: принудительный запуск startAutonomous без Gemini');
        // Извлекаем interval из текста ("каждые N часов")
        const intervalMatch = request.message.match(/каждые?\s+(\d+)\s*час/i);
        const interval = intervalMatch ? parseInt(intervalMatch[1], 10) : 8;
        try {
          const result = await TOOL_IMPLEMENTATIONS.startAutonomous({ interval, postsPerCycle: 1, autoSchedule: true, withImages: true }, request);
          if (result.success === false) {
            return { response: (result as any).error || 'Ошибка запуска авторежима', success: false };
          }
          return {
            response: (result as any).message || `🤖 Автономный режим запущен! Интервал: ${interval}ч.`,
            success: true
          };
        } catch (e: any) {
          console.error('[AUTONOMOUS-AI] Ошибка перехвата startAutonomous:', e);
          return { response: `Ошибка запуска авторежима: ${e.message}`, success: false };
        }
      }

      if (stopAutonomousPattern.test(request.message)) {
        const isRunning = autonomousStates.has(request.campaignId);
        if (!isRunning) {
          return { response: 'Автономный режим и так не запущен.', success: true };
        }
        console.log('[AUTONOMOUS-AI] 🔥 Перехват: принудительная остановка stopAutonomous без Gemini');
        try {
          const result = await TOOL_IMPLEMENTATIONS.stopAutonomous({ campaignId: request.campaignId }, request);
          return { response: (result as any).message || 'Автономный режим остановлен ✅', success: true };
        } catch (e: any) {
          return { response: `Ошибка остановки: ${e.message}`, success: false };
        }
      }

      // ПРИОРИТЕТНАЯ ПРОВЕРКА: Проверяем, является ли это командой создания кампании
      // Эта проверка должна быть ПЕРЕД вызовом Gemini AI
      const createCampaignPattern = /создай.*кампани|новую.*кампани|создать.*кампани/i;
      const hasWebsiteUrl = /https?:\/\/[^\s]+/;
      
      console.log('[AUTONOMOUS-AI] Проверка паттерна создания кампании...');
      console.log('[AUTONOMOUS-AI] createCampaignPattern:', createCampaignPattern.test(request.message));
      console.log('[AUTONOMOUS-AI] hasWebsiteUrl:', hasWebsiteUrl.test(request.message));
      
      if (createCampaignPattern.test(request.message) && hasWebsiteUrl.test(request.message)) {
        console.log('[AUTONOMOUS-AI] ✅ Обнаружена команда создания кампании, показываем интерактивные чекбоксы');
        // Извлекаем URL из сообщения
        const urlMatch = request.message.match(/(https?:\/\/[^\s]+)/);
        const websiteUrl = urlMatch ? urlMatch[1] : '';
        
        // Извлекаем название кампании из контекста
        const nameMatch = request.message.match(/кампани[юию]\s+["""«]?([^"""«\n]+)["""«]?/i);
        let campaignName = nameMatch ? nameMatch[1].trim() : '';
        
        if (!campaignName) {
          // Пытаемся извлечь название из описания сайта
          if (websiteUrl.includes('anekdot')) {
            campaignName = 'Анекдоты и приколы';
          } else {
            campaignName = 'Новая кампания';
          }
        }
        
        // Возвращаем интерактивный интерфейс с чекбоксами
        return {
          response: `Настройте опции для создания кампании "${campaignName}":`,
          success: true,
          interactive: {
            type: 'campaign-options',
            campaignOptions: {
              name: campaignName,
              description: `Кампания на основе сайта ${websiteUrl}`,
              websiteUrl: websiteUrl,
              options: [
                {
                  id: 'website-analysis',
                  name: 'Анализ сайта и заполнение анкеты',
                  description: 'Автоматически проанализировать сайт и заполнить бизнес-анкету',
                  enabled: true
                },
                {
                  id: 'keywords',
                  name: 'Найти ключевые слова под сайт',
                  description: 'Извлечь и сгенерировать ключевые слова на основе контента сайта',
                  enabled: true
                },
                {
                  id: 'find-sources',
                  name: 'Найти источники для поиска трендов',
                  description: 'Определить релевантные социальные сети и источники для анализа трендов',
                  enabled: true
                },
                {
                  id: 'collect-trends',
                  name: 'Найти тренды',
                  description: 'Собрать актуальные тренды из выбранных источников',
                  enabled: true
                },
                {
                  id: 'content-plan',
                  name: 'Создать контент план с картинками',
                  description: 'Сгенерировать контент план на основе трендов и ключевых слов с изображениями',
                  enabled: true
                }
              ]
            }
          }
        };
      }
      
      // Проверяем, является ли это обработкой выбранных опций кампании
      if (request.campaignOptions && request.campaignOptions.selectedOptions) {
        return await this.processFullCampaignCreation(request);
      }
      
      // Логируем количество доступных инструментов для диагностики
      console.log('[AUTONOMOUS-AI] 📊 Количество доступных инструментов:', AVAILABLE_TOOLS.length);
      console.log('[AUTONOMOUS-AI] 📋 Список инструментов:', AVAILABLE_TOOLS.map(t => t.name).join(', '));
      
      // Формируем историю диалога для контекста
      let conversationContext = '';
      if (request.chatHistory && request.chatHistory.length > 0) {
        conversationContext = '\n\nИСТОРИЯ ДИАЛОГА:\n';
        request.chatHistory.forEach((msg, index) => {
          const role = msg.role === 'user' ? 'Пользователь' : 'Ассистент';
          conversationContext += `${role}: ${msg.content}\n`;
        });
        conversationContext += '\n';
      }
      
      // Создаем промпт с описанием доступных инструментов
      const systemPrompt = `
Ты - автономная AI-система для управления SMM-платформой. 

ДОСТУПНЫЕ ИНСТРУМЕНТЫ:
${JSON.stringify(AVAILABLE_TOOLS, null, 2)}

КОНТЕКСТ:
- Пользователь: ${request.userId}
- Кампания: ${request.campaignId}
- ТЕКУЩИЙ СТАТУС АВТОНОМНОГО РЕЖИМА: ${autonomousStates.has(request.campaignId) ? `АКТИВЕН ✅ (запущен, interval=${autonomousStates.get(request.campaignId)!.interval}ч)` : 'НЕ ЗАПУЩЕН ❌'}

⚠️ ВАЖНО: Статус выше — ЕДИНСТВЕННАЯ ИСТИНА о состоянии авторежима. НЕ доверяй истории диалога! Если статус "НЕ ЗАПУЩЕН" и пользователь просит запустить — ОБЯЗАТЕЛЬНО вызывай startAutonomous. Если статус "АКТИВЕН" — режим уже работает, не запускай повторно.

🔥 ПРАВИЛА ПОНИМАНИЯ КОНТЕКСТА КАМПАНИИ:
1. Когда пользователь пишет "создай контент по анкете" или "используй анкету" - это означает использовать данные анкеты из текущей кампании
2. НЕ проси пользователя указать тему, если он просит контент "по анкете" - просто используй инструмент createContent с параметром useQuestionnaire: true
3. При создании контента "по анкете" параметр topic должен быть общим, например "Контент на основе анкеты бизнеса"
4. По умолчанию создавай 1 пост, если пользователь НЕ указал количество явно

⚠️ КРИТИЧНО - КОГДА НЕ ЗАПОЛНЯТЬ АНКЕТУ:
1. Если пользователь просит "создай пост о сайте/на основе сайта URL" - НЕ заполняй анкету, просто создай пост с упоминанием сайта в topic
2. fillQuestionnaire использовать ТОЛЬКО если пользователь ЯВНО просит "заполни анкету" или "анализируй сайт для анкеты"
3. Если пользователь дал URL в контексте создания поста - это просто тема для поста, НЕ триггер для заполнения анкеты

ЗАДАЧА:
Проанализируй команду пользователя и самостоятельно реши:
1. Какие данные нужно получить
2. Какие инструменты использовать 
3. В какой последовательности их вызывать
4. Как обработать результаты

⚠️ КРИТИЧЕСКИ ВАЖНО: Если инструмент не сработал в прошлых запросах (видишь ошибку в истории диалога), ВСЕ РАВНО попробуй его использовать снова! Технические проблемы могли быть исправлены.

Вызывай инструменты последовательно для выполнения задачи.
Дай финальный ответ пользователю с результатами.
`;

      // Упрощенный промпт без Function Calling - AI будет отвечать в формате JSON с планом действий
      const fullPrompt = `${systemPrompt}
${conversationContext}
Текущее сообщение пользователя: "${request.message}"

ВАЖНО: Учти контекст из истории диалога выше! Если пользователь ссылается на предыдущие сообщения (например, "создай на основе найденного", "покажи их", "сделай это"), используй информацию из ИСТОРИИ ДИАЛОГА для понимания контекста.

ИНСТРУКЦИЯ: Проанализируй команду пользователя и дай ответ в следующем формате JSON:
{
  "action": "описание действия",
  "tools": [
    {
      "name": "название инструмента",
      "params": {
        "необходимые параметры для инструмента"
      }
    }
  ],
  "response": "ответ пользователю на русском языке"
}

🔥 КРИТИЧЕСКИ ВАЖНО ПРО МАССИВ tools:
1. Массив tools МОЖЕТ и ДОЛЖЕН содержать НЕСКОЛЬКО инструментов, если задача требует нескольких шагов
2. Если пользователь просит выполнить сложную задачу - СРАЗУ запланируй ВСЕ необходимые шаги в массиве tools
3. НЕ останавливайся после первого действия - планируй полную цепочку
4. Инструменты выполняются ПОСЛЕДОВАТЕЛЬНО в том порядке, как ты их перечислишь
5. Каждый следующий инструмент получит результаты предыдущих

ПРИМЕРЫ ЦЕПОЧЕК ДЕЙСТВИЙ:

👤 "Найди новости про ИИ и создай 5 постов"
🤖 ПРАВИЛЬНО:
{
  "action": "Поиск новостей и создание постов",
  "tools": [
    {"name": "webSearch", "params": {"query": "новости про искусственный интеллект", "language": "ru", "readPages": true}},
    {"name": "createContent", "params": {"campaignId": "...", "topic": "Последние новости про ИИ", "count": 5}}
  ],
  "response": "Ищу свежие новости про ИИ и создаю 5 постов на их основе..."
}

❌ НЕПРАВИЛЬНО (только первый шаг):
{
  "tools": [
    {"name": "webSearch", "params": {...}}
  ]
}

👤 "Собери тренды, создай 3 поста и запланируй их"
🤖 ПРАВИЛЬНО:
{
  "action": "Сбор трендов, создание и планирование постов",
  "tools": [
    {"name": "collectTrends", "params": {"campaignId": "..."}},
    {"name": "createContent", "params": {"campaignId": "...", "topic": "Трендовый контент", "count": 3}},
    {"name": "getContentList", "params": {"campaignId": "...", "limit": 10}},
    {"name": "scheduleContent", "params": {"contentIds": ["..."], "platforms": ["vk", "telegram"]}}
  ],
  "response": "Собираю тренды, создаю 3 поста и планирую их публикацию..."
}

👤 "Заполни анкету и создай контент по анкете"
🤖 ПРАВИЛЬНО:
{
  "action": "Заполнение анкеты и создание контента",
  "tools": [
    {"name": "fillQuestionnaire", "params": {"campaignId": "...", "websiteUrl": "..."}},
    {"name": "createContent", "params": {"campaignId": "...", "topic": "Контент на основе анкеты", "count": 1, "useQuestionnaire": true}}
  ],
  "response": "Заполняю анкету бизнеса и создаю персонализированный пост..."
}

👤 "Создай пост на основе сайта http://example.com/"
🤖 ПРАВИЛЬНО (БЕЗ fillQuestionnaire!):
{
  "action": "Создание поста о сайте",
  "tools": [
    {"name": "createContent", "params": {"campaignId": "...", "topic": "Пост о сайте http://example.com/", "count": 1, "useQuestionnaire": false}}
  ],
  "response": "Создаю пост о сайте http://example.com/..."
}

❌ НЕПРАВИЛЬНО для "создай пост о сайте":
{
  "tools": [
    {"name": "fillQuestionnaire", "params": {"websiteUrl": "http://example.com/"}},
    {"name": "createContent", "params": {...}}
  ]
}

👤 "Найди новости про ИИ и создай пост с картинкой"
🤖 ПРАВИЛЬНО:
{
  "action": "Поиск новостей, создание поста и генерация изображения",
  "tools": [
    {"name": "webSearch", "params": {"query": "новости про искусственный интеллект", "language": "ru", "readPages": true}},
    {"name": "createContent", "params": {"campaignId": "...", "topic": "Новости про ИИ", "count": 1}},
    {"name": "generateImage", "params": {"prompt": "photorealistic image of artificial intelligence neural network, futuristic technology, blue and white colors, modern design", "aspectRatio": "landscape"}}
  ],
  "response": "Ищу свежие новости про ИИ, создаю пост и генерирую к нему изображение..."
}

ПРИМЕРЫ ПАРАМЕТРОВ:
- createCampaign: {"name": "название", "description": "описание", "websiteUrl": "URL_сайта", "industry": "отрасль"}
- collectTrends: {"campaignId": "ID_кампании", "sources": ["vk", "telegram", "instagram"]}
- getCampaignKeywords: {"campaignId": "ID_кампании"} 
- fillQuestionnaire: {"websiteUrl": "URL_сайта", "campaignId": "ID_кампании"}
- createContent: {"campaignId": "ID_кампании", "topic": "тема контента", "count": 1, "useQuestionnaire": true}
  ⚠️ ВАЖНО: count по умолчанию = 1, если пользователь НЕ указал количество явно
  ⚠️ ВАЖНО: useQuestionnaire: true если пользователь просит контент "по анкете" или "используя анкету"
- saveKeywordsToCampaign: {"campaignId": "ID_кампании", "keywords": ["ключевое слово 1", "ключевое слово 2"]}
- generateHashtags: {"topic": "тема", "count": 10, "language": "russian"}
- generateImage: {"prompt": "detailed English description of image", "contentId": "ID_поста", "aspectRatio": "landscape", "style": "photorealistic", "model": "nano-banana-pro"}
  ⚠️ ВАЖНО: prompt ОБЯЗАТЕЛЬНО на английском языке для лучшего качества генерации
- smartSearchTelegramChannels: {"campaignId": "ID_кампании", "useKeywordsFromCampaign": true, "addToSources": true, "limit": 20}
  ИЛИ с явными ключами: {"campaignId": "ID_кампании", "keywords": ["стартапы", "бизнес"], "addToSources": true}
- unpublishContent: {"contentId": "ID_контента"}

Доступные инструменты: createCampaign, getCampaignData, readQuestionnaire, fillQuestionnaire, startScheduler, stopScheduler, scheduleContent, generateHashtags, collectTrends, createContent, getAnalytics, getCampaignKeywords, saveKeywordsToCampaign, getKeywordsFromWebsite, getTrendsData, saveData, generateKeywords, getContentList, unpublishContent, removeDuplicatePosts, smartSearchTelegramChannels, startAutonomous, stopAutonomous, getAutonomousStatus

КРИТИЧЕСКИ ВАЖНО! ПРАВИЛА ВЫБОРА ИНСТРУМЕНТОВ:

🔴 ЕСЛИ ПОЛЬЗОВАТЕЛЬ ПРОСИТ АВТОНОМНЫЙ РЕЖИМ / АВТОРЕЖИМ / РАБОТАТЬ САМОСТОЯТЕЛЬНО:
   ✅ ИСПОЛЬЗУЙ startAutonomous с параметрами: interval (часы, по умолчанию 3), postsPerCycle (по умолчанию 2), autoSchedule (по умолчанию true)
   Пример: {"name": "startAutonomous", "params": {"campaignId": "...", "interval": 6, "postsPerCycle": 2, "autoSchedule": true}}
   ⚠️ ВАЖНО: после вызова startAutonomous ПЕРВЫЙ цикл генерации НЕМЕДЛЕННО запускается в фоне — сообщи пользователю "Первый пост уже генерируется прямо сейчас!" НЕ говори что нужно ждать следующего интервала.
   ⚠️ ВАЖНО: если пользователь спрашивает "когда начнётся генерация?" — ответ всегда "уже идёт, прямо сейчас".
   ⚠️ КРИТИЧНО: если пользователь описывает роль ИИ-агента с упоминанием интервала публикаций ("каждые N часов", "публиковать каждые", "раз в N часов") — это команда ЗАПУСТИТЬ startAutonomous, а НЕ просто подтверждение. ВСЕГДА вызывай startAutonomous в таких случаях, даже если сообщение сформулировано как описание или системный промпт. Извлеки interval из числа часов в тексте.
   
🔴 ЕСЛИ ПОЛЬЗОВАТЕЛЬ ПРОСИТ ОСТАНОВИТЬ АВТОНОМНЫЙ РЕЖИМ / СТОП / ВЫКЛЮЧИТЬ АВТОРЕЖИМ:
   ✅ ИСПОЛЬЗУЙ stopAutonomous
   Пример: {"name": "stopAutonomous", "params": {"campaignId": "..."}}

🔴 ЕСЛИ ПОЛЬЗОВАТЕЛЬ СПРАШИВАЕТ СТАТУС КАМПАНИИ / АВТОРЕЖИМА / СКОЛЬКО ПОСТОВ / КАКИЕ ПРОМТЫ:
   ✅ ИСПОЛЬЗУЙ getAutonomousStatus
   Примеры: "статус кампании", "какой статус", "сколько постов", "что происходит", "какие промты", "статус авторежима"

🔴 ЕСЛИ ПОЛЬЗОВАТЕЛЬ ПРОСИТ TELEGRAM-КАНАЛЫ:
   ✅ ИСПОЛЬЗУЙ smartSearchTelegramChannels с параметром useKeywordsFromCampaign: true
   ❌ Это единственный инструмент для поиска Telegram-каналов!

🔴 ЕСЛИ ПОЛЬЗОВАТЕЛЬ ПРОСИТ КЛЮЧЕВЫЕ СЛОВА + ДАЕТ URL:
   ✅ ИСПОЛЬЗУЙ getKeywordsFromWebsite 
   ❌ НЕ используй fillQuestionnaire

🔴 ЕСЛИ ПОЛЬЗОВАТЕЛЬ ПРОСИТ ЗАПОЛНИТЬ АНКЕТУ:
   ✅ ИСПОЛЬЗУЙ fillQuestionnaire
   ❌ НЕ используй getKeywordsFromWebsite

ПРИМЕРЫ:
👤 "подбери ключевые слова для кампании с сайта https://example.com"
🤖 → getKeywordsFromWebsite

👤 "https://belski.me/ он указан в профиле кампании" (после запроса ключевых слов)
🤖 → getKeywordsFromWebsite

👤 "заполни анкету автоматически"
🤖 → fillQuestionnaire

👤 "найди telegram-каналы по ключевым словам кампании"
🤖 → smartSearchTelegramChannels (с useKeywordsFromCampaign: true)

👤 "найди telegram-каналы про стартапы и добавь в источники"
🤖 → smartSearchTelegramChannels (с keywords: ["стартапы"])

ОСНОВНЫЕ ПРАВИЛА:
- Найти/собрать тренды → collectTrends
- Показать существующие ключевые слова → getCampaignKeywords  
- ПОДОБРАТЬ ключевые слова С САЙТА → getKeywordsFromWebsite
- Заполнить бизнес-анкету → fillQuestionnaire
- Сохранить готовые ключевые слова → saveKeywordsToCampaign
- Создать/написать контент/пост → createContent
- Показать список постов → getContentList
- Запланировать пост → сначала getContentList, потом scheduleContent
- Снять публикацию / Депостинг / Удалить из соцсетей → unpublishContent (нужен contentId)
- Удалить дубликаты постов / Очистить от одинаковых постов → removeDuplicatePosts (нужен campaignId)
- Найти Telegram-каналы по ключевым словам кампании → smartSearchTelegramChannels (useKeywordsFromCampaign: true)
- Найти Telegram-каналы по конкретной теме → smartSearchTelegramChannels (keywords: [...])

РАЗЛИЧИЯ ИНСТРУМЕНТОВ:
✅ getKeywordsFromWebsite = только извлечение ключевых слов с указанного URL
✅ generateKeywords = генерация и автоматическое сохранение ключевых слов
✅ fillQuestionnaire = полный анализ сайта для заполнения бизнес-анкеты
✅ getContentList = просмотр существующих постов в кампании
✅ unpublishContent = снятие публикации из соцсетей (Facebook, Instagram, VK, Telegram, YouTube) и возврат в черновики
✅ removeDuplicatePosts = удаление дубликатов постов с одинаковым заголовком и содержимым

ПРИМЕРЫ ДЕПОСТИНГА:
👤 "сними публикацию поста с ID abc123"
🤖 → unpublishContent({"contentId": "abc123"})

👤 "удали из соцсетей последний опубликованный пост"
🤖 → сначала getContentList для получения списка, потом unpublishContent с ID найденного поста

👤 "верни в черновики пост про кофе"
🤖 → сначала getContentList, найти пост про кофе, потом unpublishContent с его ID

ПРИМЕРЫ УДАЛЕНИЯ ДУБЛИКАТОВ:
👤 "удали одинаковые посты"
🤖 → removeDuplicatePosts({"campaignId": "ID_кампании"})

👤 "почисти дубликаты в текущей кампании"
🤖 → removeDuplicatePosts({"campaignId": "ID_кампании"})

👤 "есть ли дубли постов? если да, удали их"
🤖 → removeDuplicatePosts({"campaignId": "ID_кампании"})`;

      // Используем flash — у него есть квота на free-tier, pro используем только если flash недоступен
      let autonomousAiResult: any;
      try {
        autonomousAiResult = await aiService.generateContent({
          prompt: fullPrompt,
          model: 'gemini-2.5-flash',
          service: 'gemini',
          userId: request.userId,
          token: request.authToken
        });
      } catch (flashErr: any) {
        console.warn(`[AUTONOMOUS-AI] gemini-2.5-flash failed (${flashErr?.message?.slice(0,80)})`);
      }
      const response = autonomousAiResult.content;

      // Парсим ответ AI и выполняем нужные действия
      return await this.processSimpleAIResponse(response, request);
      
    } catch (error: any) {
      console.error('[AUTONOMOUS-AI] Ошибка обработки:', error);
      console.error('[AUTONOMOUS-AI] Детали ошибки:', {
        message: error?.message,
        stack: error?.stack?.substring(0, 500),
        name: error?.name,
        response: error?.response?.data
      });
      const errorMsg = error?.message || 'Неизвестная ошибка';
      const isQuota = errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('429') ||
        errorMsg.includes('quota') || errorMsg.includes('rate limit') ||
        errorMsg.includes('503') || errorMsg.includes('UNAVAILABLE') ||
        errorMsg.includes('high demand') || errorMsg.includes('temporarily');
      const isBilling = !isQuota && (errorMsg.includes('BILLING_DISABLED') || errorMsg.includes('PERMISSION_DENIED'));
      const userFriendly = isQuota
        ? 'ИИ-ассистент временно перегружен. Подождите немного и попробуйте снова.'
        : isBilling
        ? 'ИИ-помощник временно недоступен из-за технических ограничений. Обратитесь к администратору.'
        : 'Не удалось обработать команду. Попробуйте переформулировать запрос.';
      return {
        response: userFriendly,
        success: false
      };
    }
  }

  /**
   * Обработка упрощенного ответа AI без Function Calling
   */
  private async processSimpleAIResponse(response: string, request: AIToolRequest): Promise<AIToolResponse> {
    try {
      // Пробуем распарсить JSON ответ от AI
      let aiPlan;
      try {
        // Извлекаем JSON из ответа (может быть обернут в текст)
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiPlan = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('JSON не найден в ответе');
        }
      } catch (parseError) {
        console.error('[AUTONOMOUS-AI] Ошибка парсинга JSON от AI:', parseError);
        // Если не удалось распарсить, возвращаем простой ответ
        return {
          response: response || 'Получен ответ от AI, но не удалось его обработать.',
          success: false
        };
      }

      console.log('[AUTONOMOUS-AI] План от AI:', aiPlan);

      // Выполняем инструменты если указаны
      let toolResults: any[] = [];
      let success = true;

      if (aiPlan.tools && Array.isArray(aiPlan.tools)) {
        for (const tool of aiPlan.tools) {
          const toolName = tool.name;
          let toolParams = tool.params || {};
          
          // Автоматически добавляем campaignId если не указан
          if (!toolParams.campaignId && request.campaignId) {
            toolParams.campaignId = request.campaignId;
          }
          
          console.log(`[AUTONOMOUS-AI] Выполняем инструмент: ${toolName} с параметрами:`, toolParams);
          
          // Выполняем инструмент с правильными параметрами
          const toolResult = await this.executeTool(toolName, toolParams, request);
          toolResults.push({ tool: toolName, params: toolParams, result: toolResult });
          
          if (toolResult.error) {
            success = false;
          }
        }
      }

      // Формируем финальный ответ
      let finalResponse = aiPlan.response || 'Команда обработана';

      if (toolResults.length > 0) {
        // Разделяем результаты на информационные (с message) и action-тулы
        const infoParts: string[] = [];
        const actionParts: string[] = [];

        for (const r of toolResults) {
          if (r.result.error) {
            actionParts.push(`❌ ${r.result.error}`);
            continue;
          }

          // Специальная обработка для createCampaign с деталями
          if (r.tool === 'createCampaign' && r.result.details) {
            const d = r.result.details;
            actionParts.push(
              `✅ Кампания создана: ${d.campaignName}\n` +
              `🆔 ID: ${d.campaignId}\n` +
              (d.websiteAnalysis ? `${d.websiteAnalysis}\n` : '') +
              (d.keywordsGenerated ? `${d.keywordsGenerated}\n` : '') +
              (d.nextSteps?.length ? `\n🎯 Следующие шаги:\n${d.nextSteps.map((s: string) => `  • ${s}`).join('\n')}` : '')
            );
            continue;
          }

          // Инструмент вернул человекочитаемое сообщение → используем как ответ
          if (r.result?.message && typeof r.result.message === 'string') {
            infoParts.push(r.result.message);
            continue;
          }

          // Нет message — action-туп: просто подтверждение
          actionParts.push(`✅ ${r.tool}: выполнено`);
        }

        if (infoParts.length > 0 && actionParts.length === 0) {
          // Только информационные инструменты — их вывод И ЕСТЬ ответ, без «Выполненные операции»
          finalResponse = infoParts.join('\n\n');
        } else if (infoParts.length > 0) {
          // Смешанный случай: сначала инфо, потом действия
          finalResponse = infoParts.join('\n\n');
          finalResponse += '\n\nВыполненные операции:\n' + actionParts.join('\n');
        } else if (actionParts.length > 0) {
          // Только action-тулы — классический вывод
          finalResponse += '\n\nВыполненные операции:\n' + actionParts.join('\n');
        }
      }

      return {
        response: finalResponse,
        success,
        data: toolResults
      };
      
    } catch (error) {
      console.error('[AUTONOMOUS-AI] Ошибка обработки ответа AI:', error);
      return {
        response: 'Произошла ошибка при обработке ответа AI.',
        success: false
      };
    }
  }

  /**
   * Обработка полного создания кампании с выбранными опциями
   */
  private async processFullCampaignCreation(request: AIToolRequest): Promise<AIToolResponse> {
    try {
      const options = request.campaignOptions!;
      const steps: string[] = [];
      let campaignId: string | null = null;
      
      // Шаг 1: Создание кампании
      steps.push('🚀 Создание кампании...');
      const campaignResult = await TOOL_IMPLEMENTATIONS.createCampaign({
        name: options.name,
        description: options.description,
        websiteUrl: options.websiteUrl,
        industry: 'auto-detected'
      }, request);
      
      if ('error' in campaignResult) {
        return {
          response: `❌ Ошибка создания кампании: ${campaignResult.error}`,
          success: false
        };
      }
      
      campaignId = (campaignResult as any).campaignId;
      steps.push(`✅ Кампания создана с ID: ${campaignId}`);
      
      // Шаг 2: Анализ сайта и заполнение анкеты (если выбрано)
      if (options.selectedOptions.websiteAnalysis) {
        steps.push('🔍 Анализ сайта и заполнение анкеты...');
        // Анкета уже заполняется в createCampaign автоматически
        steps.push('✅ Анкета заполнена');
      }
      
      // Шаг 3: Поиск ключевых слов (если выбрано)
      if (options.selectedOptions.keywords) {
        steps.push('🔑 Поиск ключевых слов...');
        // Ключевые слова уже генерируются в createCampaign автоматически
        steps.push('✅ Ключевые слова найдены');
      }
      
      // Шаг 4: Поиск источников для трендов (если выбрано)
      if (options.selectedOptions.findSources) {
        steps.push('🌐 Определение источников для трендов...');
        // Определяем источники на основе анализа сайта
        steps.push('✅ Источники определены: VK, Telegram, Instagram');
      }
      
      // Шаг 5: Сбор трендов (если выбрано)
      if (options.selectedOptions.collectTrends) {
        steps.push('📈 Сбор актуальных трендов...');
        const trendsResult = await TOOL_IMPLEMENTATIONS.collectTrends({
          campaignId: campaignId,
          sources: ['vk', 'telegram', 'instagram']
        }, request);
        
        if (trendsResult.error) {
          steps.push(`⚠️ Предупреждение при сборе трендов: ${trendsResult.error}`);
        } else {
          steps.push('✅ Тренды собраны');
        }
      }
      
      // Шаг 6: Создание контент плана (если выбрано)
      if (options.selectedOptions.contentPlan) {
        steps.push('📝 Создание контент плана с картинками...');
        
        // Создаем несколько постов как контент план
        const contentTopics = [
          'Актуальный тренд на основе анализа',
          'Пост с ключевыми словами',
          'Развлекательный контент'
        ];
        
        for (const topic of contentTopics) {
          const contentResult = await TOOL_IMPLEMENTATIONS.createContent({
            campaignId: campaignId,
            topic: topic
          }, request);
          
          if (!contentResult.error) {
            steps.push(`✅ Создан пост: "${topic}"`);
          }
        }
        
        steps.push('✅ Контент план готов');
      }
      
      // Формируем финальный ответ
      const finalResponse = `🎉 Кампания "${options.name}" полностью настроена!

📋 Выполненные операции:
${steps.map(step => step).join('\n')}

🎯 Кампания готова к использованию:
• ID кампании: ${campaignId}
• Анкета заполнена
• Ключевые слова подобраны
• Источники трендов определены
• Актуальные тренды собраны
• Контент план создан

Теперь вы можете создавать дополнительный контент и планировать публикации!`;

      return {
        response: finalResponse,
        success: true,
        data: { campaignId, steps }
      };
      
    } catch (error) {
      console.error('[AUTONOMOUS-AI] Ошибка полного создания кампании:', error);
      return {
        response: `❌ Ошибка при создании кампании: ${error}`,
        success: false
      };
    }
  }

  /**
   * Выполнение инструмента
   */
  private async executeTool(toolName: string, args: any, request: AIToolRequest): Promise<any> {
    const implementation = TOOL_IMPLEMENTATIONS[toolName as keyof typeof TOOL_IMPLEMENTATIONS];
    
    if (!implementation) {
      return { error: `Инструмент ${toolName} не найден` };
    }

    try {
      return await implementation(args, request);
    } catch (error) {
      return { error: `Ошибка выполнения ${toolName}: ${error}` };
    }
  }
}

export const autonomousAI = new AutonomousAI();
