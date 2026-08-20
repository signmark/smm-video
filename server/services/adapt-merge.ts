/**
 * SM-35. Сохранение текстов по площадкам своими силами.
 *
 * Раньше маршрут «Адаптировать под площадки» ничего не сохранял: он отправлял
 * задание в n8n, а n8n из продукта выведен. Тексты, написанные человеком под
 * каждую соцсеть, не доезжали никуда.
 *
 * Записать их «как пришло» нельзя. Интерфейс присылает полный объект площадки
 * со статусом «ожидает» и пустыми `postId`, `postUrl`, `publishedAt` — если
 * положить это поверх уже опубликованной площадки, у поста пропадёт ссылка на
 * публикацию и он снова станет неопубликованным. Поэтому из запроса берём
 * ТОЛЬКО текст и то, что к тексту относится, а всё, что описывает факт
 * публикации, остаётся как было.
 */

/** Поля, которые человек правит в окне адаптации. Остальное — не его дело. */
const TEXT_FIELDS = ['caption', 'hashtags', 'isEdited'] as const;

/** Поля, описывающие факт публикации: их запрос перезаписать не может. */
export const PUBLICATION_FIELDS = ['status', 'postId', 'postUrl', 'publishedAt', 'error'] as const;

export interface AdaptMergeResult {
  /** Что записывать в campaign_content.social_platforms. */
  next: Record<string, any>;
  /** Площадки, текст которых сохранён. */
  saved: string[];
  /** Площадки, пропущенные из-за пустого текста: пустотой затирать нечего. */
  skipped: string[];
}

function textOf(value: any): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Сливает присланные тексты с тем, что уже лежит у записи контента.
 *
 * Правила:
 * 1. Площадка, которой нет в запросе, не меняется вовсе — в том числе не
 *    получает пустую строку.
 * 2. Площадка с пустым текстом пропускается: человек её не заполнил, а стирать
 *    сохранённое молча — худшее, что можно сделать.
 * 3. У уже существующей площадки обновляется только текст; статус, ссылка,
 *    идентификатор поста и время публикации сохраняются.
 * 4. Для новой площадки статус берётся из запроса (там «ожидает»), а если его
 *    нет — ставим «ожидает» сами: запись без статуса ломает список публикаций.
 */
export function mergeAdaptedPlatforms(
  previous: Record<string, any> | null | undefined,
  incoming: Record<string, any> | null | undefined,
): AdaptMergeResult {
  const base: Record<string, any> = { ...(previous && typeof previous === 'object' ? previous : {}) };
  const next: Record<string, any> = { ...base };
  const saved: string[] = [];
  const skipped: string[] = [];

  const source = incoming && typeof incoming === 'object' ? incoming : {};

  for (const [platform, raw] of Object.entries(source)) {
    if (!raw || typeof raw !== 'object') {
      skipped.push(platform);
      continue;
    }
    const caption = textOf((raw as any).caption).trim();
    if (!caption) {
      skipped.push(platform);
      continue;
    }

    const before = base[platform] && typeof base[platform] === 'object' ? base[platform] : null;
    const merged: Record<string, any> = { ...(before || {}) };

    for (const field of TEXT_FIELDS) {
      if (field in (raw as any)) merged[field] = (raw as any)[field];
    }
    merged.caption = textOf((raw as any).caption);

    if (!before) {
      // Новая площадка: статус нужен, иначе запись выпадает из списков.
      merged.status = (raw as any).status || 'pending';
    }

    next[platform] = merged;
    saved.push(platform);
  }

  return { next, saved, skipped };
}

/** Человеческий итог операции — его видит тот, кто нажал «Сохранить». */
export function adaptSaveMessage(result: AdaptMergeResult): string {
  if (!result.saved.length && !result.skipped.length) return 'Сохранять нечего: тексты не заданы';
  if (!result.saved.length) return 'Ни один текст не сохранён: все площадки пустые';
  const head = `Сохранено площадок: ${result.saved.length}`;
  if (!result.skipped.length) return head;
  return `${head}; пропущено пустых: ${result.skipped.length}`;
}
