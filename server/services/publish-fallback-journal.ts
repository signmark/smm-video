/**
 * Журнал состоявшихся публикаций на случай, когда база недоступна (AI-85).
 *
 * ЗАЧЕМ. Планировщик отправляет пост во внешнюю сеть, а затем записывает результат
 * в Directus. Если внешняя отправка удалась, а запись — нет, то до этой правки
 * ошибка записи считалась ошибкой публикации: пост уходил к подписчикам, а система
 * его не помнила и позже отправляла ещё раз. В канале клиента `@mirgranita1` так
 * появились посты 16 (30.07) и 17 (31.07) — первого нет в базе вовсе, второй ушёл
 * повторно 03.08 как пост 18 с тем же текстом.
 *
 * Directus в такой момент недоступен по определению, поэтому «запомнить факт»
 * можно только вне его. Журнал — простой файл на диске приложения: строка JSON
 * на каждую состоявшуюся публикацию. Он нужен для двух вещей:
 *   1. перед отправкой планировщик спрашивает журнал «мы это уже публиковали?»
 *      и не публикует второй раз, даже если в базе следов нет;
 *   2. когда база возвращается, запись догоняется, а строка убирается.
 *
 * ЧЕГО ЖУРНАЛ НЕ ДЕЛАЕТ. Он не заменяет базу и не является источником правды для
 * интерфейса. Он живёт ровно до момента, пока запись не догнана.
 *
 * ГРАНИЦА, О КОТОРОЙ НАДО ЗНАТЬ. У боевого контейнера smm томов нет, файловая
 * система эфемерна. Перезапуск контейнера журнал переживает, ПЕРЕСОЗДАНИЕ на
 * выкатке — нет. То есть защита закрывает недоступность базы (минуты и часы), но
 * не случай «база лежала, и в это же окно прошла выкатка». Чтобы закрыть и его,
 * нужен том для каталога PUBLISH_JOURNAL_DIR либо опрос самой площадки
 * «есть ли уже наш пост» — и то и другое отдельной задачей.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { log } from '../utils/logger';

export interface PublishedEntry {
  contentId: string;
  platform: string;
  /** Поля, которые не удалось записать в `social_platforms`. */
  fields: Record<string, any>;
  /** Когда публикация реально состоялась. */
  publishedAt: string;
  /** Текст ошибки записи — чтобы потом было видно, почему запись не прошла. */
  recordError: string;
}

const FILE_NAME = 'published-not-recorded.jsonl';

/**
 * Каталог читается при каждом обращении, а не один раз при загрузке модуля:
 * иначе значение переменной окружения замерзает, и подменить его (в тестах или
 * при смене тома) уже нельзя.
 */
function journalDir(): string {
  return process.env.PUBLISH_JOURNAL_DIR || '/tmp/smm-publish-journal';
}

function journalPath(): string {
  return path.join(journalDir(), FILE_NAME);
}

function keyOf(contentId: string, platform: string): string {
  return `${contentId}:${platform}`;
}

/**
 * Дописывает факт публикации. Никогда не бросает: журнал — подстраховка, и его
 * собственный сбой не должен превращаться в ещё одну потерю.
 */
export async function recordPublished(entry: PublishedEntry): Promise<boolean> {
  try {
    await fs.mkdir(journalDir(), { recursive: true });
    await fs.appendFile(journalPath(), JSON.stringify(entry) + '\n', 'utf8');
    log(
      `[AI-85] Публикация ${entry.platform} для ${entry.contentId} состоялась, но в базу не записалась — ` +
        `запомнил в журнале ${journalPath()}: ${entry.recordError}`,
      'scheduler',
      'error'
    );
    return true;
  } catch (err: any) {
    log(
      `[AI-85] КРИТИЧНО: публикация ${entry.platform} для ${entry.contentId} состоялась, ` +
        `но её не удалось ни записать в базу, ни занести в журнал: ${err?.message || err}`,
      'scheduler',
      'error'
    );
    return false;
  }
}

/** Читает журнал целиком. Битые строки пропускает, а не роняет разбор. */
export async function readJournal(): Promise<PublishedEntry[]> {
  try {
    const raw = await fs.readFile(journalPath(), 'utf8');
    const out: PublishedEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.contentId === 'string' && typeof parsed.platform === 'string') {
          out.push(parsed as PublishedEntry);
        }
      } catch {
        // строка повреждена — она не должна мешать остальным
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Была ли уже состоявшаяся публикация этого материала на эту площадку.
 * Именно этот вопрос задаётся перед отправкой.
 */
export async function wasPublished(contentId: string, platform: string): Promise<PublishedEntry | null> {
  const entries = await readJournal();
  const wanted = keyOf(contentId, platform);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (keyOf(entries[i].contentId, entries[i].platform) === wanted) return entries[i];
  }
  return null;
}

/** Убирает строки, запись которых успешно догнали. */
export async function forget(contentId: string, platform: string): Promise<void> {
  try {
    const entries = await readJournal();
    const wanted = keyOf(contentId, platform);
    const left = entries.filter((e) => keyOf(e.contentId, e.platform) !== wanted);
    if (left.length === entries.length) return;
    await fs.mkdir(journalDir(), { recursive: true });
    await fs.writeFile(journalPath(), left.map((e) => JSON.stringify(e)).join('\n') + (left.length ? '\n' : ''), 'utf8');
  } catch (err: any) {
    log(`[AI-85] Не удалось убрать строку журнала для ${contentId}:${platform}: ${err?.message || err}`, 'scheduler', 'warn');
  }
}
