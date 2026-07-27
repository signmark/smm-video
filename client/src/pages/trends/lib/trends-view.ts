// Общие утилиты отображения трендов. Вынесены из pages/trends/index.tsx, чтобы
// (1) не захламлять страницу и (2) переиспользовать в мемоизированной карточке
// и хуке фильтрации. Аналитика скоро расширяется под риал-тайм скраппер — держим
// «чистую» бизнес-логику отдельно от гигантского компонента страницы.

import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

// Универсальный тип тренда: поля приходят в обеих конвенциях (snake/camel),
// плюс произвольные поля из raw-скраппера — поэтому индексная сигнатура.
export interface TrendLike {
  id: string;
  title: string;
  [key: string]: any;
}

export type Platform = "instagram" | "vk" | "telegram" | "facebook" | "unknown";

/**
 * Формирует URL для прокси-картинки. Без cache-buster'а: сервер отдаёт
 * Cache-Control: public, max-age=86400, и стабильный URL позволяет браузеру
 * не перекачивать превью на каждый заход на страницу. Прежние параметры
 * _t/forceType/itemId роут /api/proxy-image игнорирует — не шлём их вовсе
 * (ретрай после ошибки добавляет &_retry=true, чтобы обойти закэшированный сбой).
 * itemId в сигнатуре оставлен для совместимости вызовов.
 */
export function createProxyImageUrl(imageUrl: string, _itemId?: string): string {
  if (!imageUrl) return "";
  return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
}

/** Определяет платформу по полю sourceType (только по нему — как в списке трендов). */
export function detectPlatform(sourceType?: string): Platform {
  if (!sourceType) return "unknown";
  const normalized = sourceType.toLowerCase().trim();
  if (normalized === "instagram") return "instagram";
  if (normalized === "vk" || normalized === "vkontakte") return "vk";
  if (normalized === "telegram") return "telegram";
  if (normalized === "facebook") return "facebook";
  return "unknown";
}

/** Относительное время («2 часа назад»); падение форматирования не роняет карточку. */
export function formatRelativeTime(date: Date): string {
  try {
    return formatDistanceToNow(date, { addSuffix: true, locale: ru });
  } catch (error) {
    console.error("Error formatting date:", error);
    return "Н/Д";
  }
}

/**
 * Время публикации поста в мс для фильтра по периоду.
 * Приоритет: postDate (считается на сервере из raw_source_data) → дата вставки
 * записи (created_at/createdAt) как запасной вариант. null — даты нет вовсе.
 */
export function getPostTimeMs(topic: TrendLike): number | null {
  const raw =
    topic.postDate ??
    topic.post_date ??
    topic.created_at ??
    topic.createdAt ??
    null;
  if (raw == null) return null;

  // Floor 2000-01-01: мусорные значения (напр. «5» секунд) дают 1970 год и
  // прячут пост во всех окнах периода — такое считаем «даты нет».
  const MIN_SANE_MS = 946684800000;

  if (typeof raw === "number") {
    // unix seconds vs ms
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return Number.isFinite(ms) && ms >= MIN_SANE_MS ? ms : null;
  }
  const t = new Date(raw).getTime();
  return Number.isNaN(t) || t < MIN_SANE_MS ? null : t;
}

/** Первое изображение из media_links (JSON-строка или уже распарсенный объект). */
export function parseFirstImage(topic: TrendLike): string | undefined {
  const mediaLinksStr = topic.media_links || topic.mediaLinks;
  if (!mediaLinksStr) return undefined;

  try {
    let parsed: any = mediaLinksStr;
    if (typeof mediaLinksStr === "string") {
      parsed = JSON.parse(mediaLinksStr);
    }
    if (parsed && Array.isArray(parsed.images) && parsed.images.length > 0) {
      return parsed.images[0];
    }
  } catch {
    // битый JSON — просто нет превью
  }
  return undefined;
}
