/**
 * SM-41. Что показывать человеку про связь с площадкой.
 *
 * Зачем. На странице кампании строка «Настройки публикации — Соцсети настроены»
 * стояла с зелёной галочкой, а прямо под ней Telegram был помечен красным «Нет
 * связи». Два ответа на разные вопросы выглядели как один противоречивый: подпись
 * отвечала «поля заполнены», метка — «дойдёт ли публикация».
 *
 * Владелец заметил верно: подпись относится ко всем площадкам сразу, и при пяти
 * рабочих из шести галочка стоит по делу. Врёт не она, а молчание рядом с ней.
 * Поэтому подпись обязана назвать неисправную площадку, а не просто остаться
 * зелёной.
 *
 * Три состояния, и путать их нельзя: «не проверяли» — не то же самое, что
 * «связи нет», и уж точно не то же, что «связь есть».
 */

export type ConnectionTone = 'ok' | 'fail' | 'unknown';

export interface ConnectionCheckRecord {
  at: string;
  ok: boolean;
  reason?: string;
}

export interface ConnectionView {
  tone: ConnectionTone;
  label: string;
  /** Причина отказа площадки — показывать под меткой, не вместо неё. */
  reason?: string;
  /** Когда проверяли, человеческими словами. Без этого исход стареет молча. */
  checkedAt?: string;
}

export const PLATFORM_TITLES: Record<string, string> = {
  telegram: 'Telegram',
  vk: 'ВКонтакте',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  threads: 'Threads',
};

export function platformTitle(platform: string): string {
  return PLATFORM_TITLES[platform] || platform;
}

/** Тот же разбор, что на сервере: обрывок исхода — это отсутствие исхода. */
export function readCheckRecord(platformSettings: any): ConnectionCheckRecord | null {
  const raw = platformSettings?.lastCheck;
  if (!raw || typeof raw !== 'object') return null;
  const at = typeof raw.at === 'string' ? raw.at.trim() : '';
  if (!at || Number.isNaN(Date.parse(at))) return null;
  if (typeof raw.ok !== 'boolean') return null;
  const reason = typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : undefined;
  return reason ? { at, ok: raw.ok, reason } : { at, ok: raw.ok };
}

function twoDigits(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * «Когда проверяли» словами. Точное время суток важнее давности в минутах:
 * человек соотносит его с тем, что делал сам.
 */
export function formatCheckedAt(at: string, now: Date): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return '';

  const minutesAgo = Math.floor((now.getTime() - when.getTime()) / 60000);
  if (minutesAgo < 1) return 'только что';

  const time = `${twoDigits(when.getHours())}:${twoDigits(when.getMinutes())}`;
  const sameDay = when.toDateString() === now.toDateString();
  if (sameDay) return `сегодня в ${time}`;

  const yesterday = new Date(now.getTime());
  yesterday.setDate(yesterday.getDate() - 1);
  if (when.toDateString() === yesterday.toDateString()) return `вчера в ${time}`;

  return `${when.getDate()} ${MONTHS[when.getMonth()]} в ${time}`;
}

/**
 * Состояние одной площадки. `connected` — заполнены ли настройки; считается
 * общим правилом приложения (lib/platform-connection), сюда приходит готовым.
 */
export function connectionView(
  platformSettings: any,
  connected: boolean,
  now: Date,
): ConnectionView {
  if (!connected) return { tone: 'unknown', label: 'Не настроено' };

  const check = readCheckRecord(platformSettings);
  if (!check) return { tone: 'unknown', label: 'Связь не проверяли' };

  const checkedAt = formatCheckedAt(check.at, now);
  if (check.ok) return { tone: 'ok', label: 'Связь есть', checkedAt };
  return { tone: 'fail', label: 'Нет связи', reason: check.reason, checkedAt };
}

export interface SocialSummary {
  completed: boolean;
  label: string;
  /** Пояснение, за что стоит галочка. Появляется, когда есть неисправная площадка. */
  hint?: string;
  /**
   * Цвет отметки. Требование владельца: галочка при неисправной сети остаётся,
   * но зелёной быть не должна — иначе она читается как «всё хорошо».
   */
  tone: 'ok' | 'warn' | 'none';
  /** Текст всплывающей подсказки у отметки. Есть только у жёлтой. */
  alt?: string;
}

export interface SummaryInput {
  platform: string;
  view: ConnectionView;
}

/**
 * Подпись строки «Настройки публикации». Галочка отвечает за настроенность и
 * при одной сломанной площадке из шести остаётся честной — но обязана назвать
 * сломанную, иначе рядом с ней красное «Нет связи» выглядит противоречием.
 */
export function socialSummary(items: SummaryInput[]): SocialSummary {
  const configured = items.filter((i) => i.view.tone !== 'unknown' || i.view.label !== 'Не настроено');
  if (configured.length === 0) return { completed: false, label: 'Соцсети не настроены', tone: 'none' };

  const broken = configured.filter((i) => i.view.tone === 'fail').map((i) => platformTitle(i.platform));
  if (broken.length === 0) return { completed: true, label: 'Соцсети настроены', tone: 'ok' };

  const named = broken.slice(0, 2).join(', ');
  const rest = broken.length > 2 ? ` и ещё ${broken.length - 2}` : '';

  // Решение владельца: если не отвечает ни одна настроенная площадка, галочке
  // стоять не за чем — публиковать всё равно некуда. Отказ одной из нескольких
  // её не гасит, отказ единственной — гасит.
  if (broken.length === configured.length) {
    return {
      completed: false,
      label: `Нет связи: ${named}${rest}`,
      hint: 'Доступы заполнены, но ни одна площадка не отвечает. Проверьте подключение.',
      tone: 'warn',
      alt: 'Ни одна настроенная сеть не отвечает',
    };
  }

  return {
    completed: true,
    label: `Соцсети настроены · ${named}${rest}: нет связи`,
    // Требование владельца: человек должен понимать, за что стоит галочка.
    // Иначе отказ одной площадки читается как «всё сломалось».
    hint: 'Галочка стоит за заполненные доступы. Связь у каждой площадки проверяется отдельно.',
    tone: 'warn',
    alt: broken.length === 1
      ? `Ошибка связи у сети ${broken[0]}`
      : `Ошибка связи у нескольких сетей: ${broken.join(', ')}`,
  };
}
