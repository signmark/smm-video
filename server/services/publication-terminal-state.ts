/**
 * Задача 108 — запись публикации обязана приходить к окончательному состоянию.
 *
 * Что было сломано (данные прода на 15.08.2026):
 *  - 22 записи «частично» и 3 «запланировано», у которых КАЖДАЯ площадка давно
 *    в терминальном состоянии, а сама запись годами висит в рабочем статусе.
 *    Одна из них — от 30.05.2025: единственная площадка Telegram ответила
 *    «бот не может писать другому боту», а пользователю до сих пор показывают
 *    «запланировано». Источник — ветка планировщика «всё failed — оставляем
 *    текущий», где текущим был именно рабочий статус.
 *  - 1 запись в статусе «публикуется» с пустым списком площадок: такой путь
 *    в планировщике не обработан вовсе.
 *  - Постоянные причины отказа («чат не найден», «бот заблокирован»,
 *    «токен недействителен») тратили те же три попытки, что и сетевой сбой.
 *
 * Здесь только чистые решения — ни одного обращения к сети и к БД, чтобы их
 * можно было проверять по результату, а не по тексту исходника.
 */

/** Состояния площадки, из которых сама по себе она уже не сдвинется. */
const TERMINAL_PLATFORM_STATUSES = new Set([
  "published",
  "failed",
  "error",
  "cancelled",
  // SM-15: пост реально ушёл на площадку, запись о нём не сохранилась.
  // Повторять нельзя — для статуса записи это «опубликовано».
  "publish_succeeded_record_failed",
]);

/** Состояния площадки, означающие, что пост живым людям уже показан. */
const PUBLISHED_LIKE_STATUSES = new Set([
  "published",
  "publish_succeeded_record_failed",
]);

/** Рабочие статусы записи: только их планировщик и разбирает. */
const WORKING_CONTENT_STATUSES = new Set([
  "scheduled",
  "partial",
  "pending",
  "publishing",
]);

export interface PlatformEntry {
  status?: string | null;
  postUrl?: string | null;
  error?: string | null;
  lastError?: string | null;
  [key: string]: any;
}

export type PlatformMap = Record<string, PlatformEntry>;

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Площадка либо ещё ждёт продолжения, либо уже нет.
 * Непригодная запись (не объект) держать публикацию не должна.
 */
export function isPlatformTerminal(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return true;
  const data = entry as PlatformEntry;
  if (trimmed(data.postUrl)) return true;
  return TERMINAL_PLATFORM_STATUSES.has(String(data.status));
}

export function isPlatformPublishedLike(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const data = entry as PlatformEntry;
  if (trimmed(data.postUrl)) return true;
  return PUBLISHED_LIKE_STATUSES.has(String(data.status));
}

/**
 * Причина отказа, которая сама не пройдёт: чат удалён, бот заблокирован,
 * учётные данные недействительны, площадка не настроена.
 *
 * Осознанно НЕ включены временные: лимиты частоты, таймауты, 5xx, обрывы сети —
 * ради них ретраи и существуют.
 */
export function isPermanentPublishError(errMsg: string | null | undefined): boolean {
  const lower = trimmed(errMsg).toLowerCase();
  if (!lower) return false;

  // Временное имеет приоритет: «too many requests» встречается вместе с 400.
  const transient = [
    "too many requests",
    "rate limit",
    "retry after",
    "timeout",
    "timed out",
    "econnreset",
    "econnrefused",
    "etimedout",
    "socket hang up",
    "network error",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "internal server error",
    "temporarily unavailable",
  ];
  if (transient.some((t) => lower.includes(t))) return false;

  const permanent = [
    // Учётные данные
    "user authorization failed",
    "application authorization failed",
    "invalid_token",
    "invalid token",
    "token expired",
    "token is invalid",
    "invalid access_token",
    "invalid access token",
    "oauthinvalidtoken",
    "invalid oauth",
    "error_subcode: 458",
    "error_subcode: 460",
    "токен недействителен",
    "токен истек",
    "токен истёк",
    // Адресат
    "chat not found",
    "chat_id is empty",
    "peer_id_invalid",
    "bot was blocked",
    "bots can\x27t send messages to bots",
    "user is deactivated",
    "user_deactivated",
    "group chat was upgraded",
    // Настройка
    "не настроен для кампании",
    "not configured",
    "настройки платформы не настроены",
    "не найдены в кампании",
    "not found in campaign",
    "application does not have permission",
    // Сам материал
    "контент не найден",
    "отсутствует изображение",
    "is not supported",
    "не поддерживается",
  ];
  return permanent.some((p) => lower.includes(p));
}

export interface StuckResolution {
  /** Каким должен стать статус записи. */
  contentStatus: string;
  /** Карта площадок после правки (та же ссылка не переиспользуется). */
  platforms: PlatformMap;
  /** Площадки, закрытые по сроку давности. */
  expiredPlatforms: string[];
  reason: "converged" | "expired" | "no-platforms";
}

export interface ResolveArgs {
  platforms: unknown;
  currentStatus: string;
  scheduledAt?: string | null;
  now: Date;
  staleDays: number;
}

/**
 * Решает, обязана ли запись прямо сейчас принять окончательный статус.
 * Возвращает null, когда трогать нечего — это штатный случай.
 *
 * Два повода закрыть:
 *  «converged» — не осталось ни одной незавершённой площадки;
 *  «expired»   — время выхода прошло давно, а площадка всё ещё ждёт: отправлять
 *                такой пост живым подписчикам нельзя.
 */
export function resolveStuckContent(args: ResolveArgs): StuckResolution | null {
  const { currentStatus, scheduledAt, now, staleDays } = args;
  if (!WORKING_CONTENT_STATUSES.has(currentStatus)) return null;

  const raw = args.platforms;
  const platforms: PlatformMap =
    raw && typeof raw === "object" && !Array.isArray(raw) ? ({ ...(raw as PlatformMap) }) : {};
  const names = Object.keys(platforms);

  const overdue = isOverdue(scheduledAt, now, staleDays);

  if (names.length === 0) {
    // Запись без площадок в рабочем статусе не сдвинется никогда.
    // Исключение оставлено планировщику: «pending» без даты он возвращает в черновик.
    if (currentStatus === "pending" && !trimmed(scheduledAt)) return null;
    return { contentStatus: "error", platforms, expiredPlatforms: [], reason: "no-platforms" };
  }

  const live = names.filter((name) => !isPlatformTerminal(platforms[name]));
  const publishedLike = () => names.some((name) => isPlatformPublishedLike(platforms[name]));

  if (live.length === 0) {
    const contentStatus = publishedLike() ? "partially_published" : "error";
    if (contentStatus === currentStatus) return null;
    return { contentStatus, platforms, expiredPlatforms: [], reason: "converged" };
  }

  if (!overdue) return null;

  const failedAt = now.toISOString();
  for (const name of live) {
    const existing = platforms[name] && typeof platforms[name] === "object" ? platforms[name] : {};
    platforms[name] = {
      ...existing,
      status: "failed",
      error: `Публикация отменена: время выхода прошло более ${staleDays} суток назад, пост так и не был опубликован.`,
      errorCode: "EXPIRED_UNPUBLISHED",
      failedAt,
    };
  }
  return {
    contentStatus: publishedLike() ? "partially_published" : "error",
    platforms,
    expiredPlatforms: live,
    reason: "expired",
  };
}

function isOverdue(scheduledAt: string | null | undefined, now: Date, staleDays: number): boolean {
  const value = trimmed(scheduledAt);
  if (!value) return false;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return false;
  return now.getTime() - at.getTime() > staleDays * 24 * 60 * 60 * 1000;
}

/** Порог давности берётся из настройки, по умолчанию неделя. */
export function getStaleDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PUBLICATION_STALE_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : 7;
}
