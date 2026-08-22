/**
 * Подтверждение записи публикации в Directus (AI-91 / SM-15).
 *
 * ЗАЧЕМ. До этого хелпера post-publish `axios.patch` в `social-publishing-router.ts`
 * шёл без своего try/catch. Если Directus сбоил на этапе записи статуса 'published',
 * пост реально уходил в Telegram/Threads/VK/Facebook/Instagram/YouTube, а в БД
 * оставалось `status=draft, social_platforms={}`. Тестировщик видел пост в канале,
 * но не видел его в приложении (фильтр по `status=published`), публиковал руками —
 * получал дубль. Планировщик тоже мог перепослать: Telegram sendMessage не
 * идемпотентен.
 *
 * ЧТО ДЕЛАЕТ. Принимает результат внешней публикации (postId/postUrl/publishedAt)
 * и текущее состояние `social_platforms` и:
 *   1. Пытается записать `status: 'published'` в Directus через helper-функцию.
 *   2. Если запись прошла — возвращает `{kind: 'success'}`.
 *   3. Если запись провалилась (timeout, 5xx, network) — пытается записать
 *      `status: 'publish_succeeded_record_failed'` с теми же postId/postUrl/
 *      publishedAt и оригинальной ошибкой. Эта отметка нужна UI и планировщику,
 *      чтобы не ретрить и не показывать как «не опубликовано».
 *   4. Если и вторая запись провалила — возвращает `{kind: 'record-failed',
 *      originalError, secondaryError}`. UI должен показать оба факта (опубликовано
 *      + не записано) и guidance 'do_not_republish'.
 *
 * ЧЕГО НЕ ДЕЛАЕТ. Не отправляет второй раз внешнему сервису. Не снимает lock —
 * это ответственность вызывающего. Не блокирует ретраи планировщика для других
 * платформ/контента.
 *
 * ЯВНОЕ ОГРАНИЧЕНИЕ. При недоступности Directus дольше бюджета повторов
 * (наш обычный ~30с) отметка `publish_succeeded_record_failed` тоже не сохранится —
 * запись останется `draft`. Защитой в этом случае служит сверка с платформой
 * из Task B (планировщик спрашивает Telegram/VK/Threads «есть ли уже наш пост»
 * перед повтором). Task B — отдельный таск, не этот.
 */
import axios from 'axios';
import { getRequiredServiceUrl } from "../config/service-urls";
import { log } from '../utils/logger';

/**
 * Фрагмент записи social_platforms для одной платформы после успешной отправки.
 */
export interface PlatformPublishedFields {
  status: 'published';
  postId: string;
  postUrl: string;
  publishedAt: string;
}

/**
 * Фрагмент записи social_platforms при отправке прошла, а запись в Directus —
 * нет.
 */
export interface PlatformRecordFailedFields {
  status: 'publish_succeeded_record_failed';
  postId: string;
  postUrl: string;
  publishedAt: string;
  originalError: string;
  recordedAt: string;
}

export type ConfirmOutcome =
  | { kind: 'success' }
  | { kind: 'record-failed'; originalError: string; markerSaved: boolean; secondaryError?: string };

/**
 * Состояние social_platforms, которое мы унаследовали из БД перед записью.
 * Используется для merge: `...current, [platform]: newFields`.
 */
export type CurrentSocialPlatforms = Record<string, unknown> | undefined;

/**
 * Заголовки для запросов к Directus (admin token). Тот же паттерн, что и в
 * `social-publishing-router.ts` — service token, не user token.
 */
function adminHeaders(): Record<string, string> {
  const token = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_SERVICE_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function directusUrl(): string {
  return getRequiredServiceUrl('DIRECTUS_URL');
}

/**
 * Axios timeout: чуть меньше обычного retry-budget, чтобы 30-секундный отказ
 * Directus не висел на запросе и не блокировал lock дольше окна.
 */
const CONFIRM_TIMEOUT_MS = 15_000;

/**
 * Хелпер: попытаться записать patch в Directus, обернув timeout/5xx в нашу
 * типизированную ошибку. Не делает второго retry — это ответственность
 * планировщика/Caller'а.
 */
async function attemptPatch(
  contentId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `${directusUrl()}/items/campaign_content/${contentId}`;
  try {
    await axios.patch(url, patch, {
      headers: adminHeaders(),
      timeout: CONFIRM_TIMEOUT_MS,
    });
    return { ok: true };
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'unknown error';
    return { ok: false, error: message };
  }
}

/**
 * Главная точка входа. Делает две попытки записи:
 *   1. `status: 'published'` — нормальный успех.
 *   2. Если первая провалилась — `status: 'publish_succeeded_record_failed'` с
 *      доказательствами публикации (postId/postUrl/publishedAt).
 *
 * Возвращает дискриминированный union. Не бросает — вызывающий сам решает,
 * что делать с `record-failed` (UI, scheduler skip и т.д.).
 */
export async function confirmPublishRecord(params: {
  contentId: string;
  platform: string;
  currentSocialPlatforms: CurrentSocialPlatforms;
  /** Доказательства того, что внешняя отправка прошла. */
  published: PlatformPublishedFields;
}): Promise<ConfirmOutcome> {
  const { contentId, platform, currentSocialPlatforms, published } = params;

  // SM-15 / AI-85 (по ревью @Clause_Dev_Hermi): MERGE с существующим объектом платформы,
// а не замена. Иначе теряется `selected: true` (и любые другие поля вроде
// `scheduledAt`, `retryCount`, которые ставит scheduler), и status-checker
// перестаёт видеть платформу как «выбранную» после первой успешной публикации.
// Раньше inline-код тоже делал replace — мы это честно сохранили, но
// починка status-checker'а без этого merge всё равно не работает.
// `as object` безопасно: caller передаёт `currentSocialPlatforms`
// из `campaign_content` коллекции (это JSON-объект, не пользовательский ввод).
const platformData = (currentSocialPlatforms?.[platform] as Record<string, unknown>) || {};

const publishedPatch: Record<string, unknown> = {
    social_platforms: {
      ...(currentSocialPlatforms || {}),
      [platform]: { ...platformData, ...published },
    },
  };

  const firstAttempt = await attemptPatch(contentId, publishedPatch);
  if (firstAttempt.ok) {
    return { kind: 'success' };
  }

  log(
    `[publish-record-confirm] Directus patch 'published' failed for ${contentId}:${platform}: ${firstAttempt.error}`,
    'social-publishing',
    'warn',
  );

  // Вторая попытка: записать маркер "publish_succeeded_record_failed" с теми же
  // postId/postUrl/publishedAt, чтобы UI знал «опубликовано, требует ручной
  // проверки», а планировщик не ретрил.
  const recordFailedPatch: Record<string, unknown> = {
    social_platforms: {
      ...(currentSocialPlatforms || {}),
      [platform]: {
        ...platformData,
        status: 'publish_succeeded_record_failed',
        postId: published.postId,
        postUrl: published.postUrl,
        publishedAt: published.publishedAt,
        originalError: firstAttempt.error,
        recordedAt: new Date().toISOString(),
      } satisfies PlatformRecordFailedFields,
    },
  };

  const secondAttempt = await attemptPatch(contentId, recordFailedPatch);
  if (secondAttempt.ok) {
    log(
      `[publish-record-confirm] Directus marker 'publish_succeeded_record_failed' saved for ${contentId}:${platform}`,
      'social-publishing',
      'warn',
    );
    return { kind: 'record-failed', originalError: firstAttempt.error, markerSaved: true };
  }

  log(
    `[publish-record-confirm] Directus marker patch ALSO failed for ${contentId}:${platform}: ${secondAttempt.error}`,
    'social-publishing',
    'error',
  );
  return {
    kind: 'record-failed',
    originalError: firstAttempt.error,
    markerSaved: false,
    secondaryError: secondAttempt.error,
  };
}

/**
 * Построить ответ для случая `publish_succeeded_record_failed` в формате,
 * который UI и тесты ожидают. Удобно вызывающему — не повторять литералы.
 *
 * Не возвращает HTTP-ошибку: пост реально опубликован, и пользователь должен
 * видеть «опубликовано», а не «не опубликовано» (иначе повторит руками).
 */
export function recordFailedResponse(params: {
  platform: string;
  published: PlatformPublishedFields;
  outcome: Extract<ConfirmOutcome, { kind: 'record-failed' }>;
}) {
  const { platform, published, outcome } = params;
  return {
    success: true,
    published: true,
    recordSaved: false,
    guidance: 'do_not_republish',
    platform,
    postId: published.postId,
    postUrl: published.postUrl,
    publishedAt: published.publishedAt,
    recordError: outcome.originalError,
    markerSaved: outcome.markerSaved,
    ...(outcome.secondaryError ? { recordErrorSecondary: outcome.secondaryError } : {}),
  };
}
