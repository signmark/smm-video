/**
 * SM-38. Автономный цикл не должен писать посты, когда теме взяться неоткуда.
 *
 * Два хвоста после AI-121, оба найдены на живом случае: 17.08 кампания «Отче наш»
 * выдала шесть черновиков про Facebook и SMM вместо постов о молитве.
 *
 * Хвост 1 — защита была мёртвой. Цикл читает ключевые слова через
 * TOOL_IMPLEMENTATIONS.getCampaignKeywords, а та ловит свою ошибку внутри и
 * возвращает её ЗНАЧЕНИЕМ: `{ error: '...' }`. Наружу исключение не выходит,
 * catch вокруг вызова не срабатывает, список слов выходит пустым — и цикл идёт
 * дальше молча. Отсюда `toolErrorText`: отказ надо увидеть в ответе, а не ждать
 * исключения.
 *
 * Хвост 2 — пустой список слов ничем не отличался от честного нуля, и кампания
 * без темы получала посты «ни о чём» без единого признака сбоя. Тему задают
 * ключевые слова, описание кампании и команда запуска. Отсюда `hasUsableTopic`.
 *
 * Почему globalPrompt НЕ считается источником темы. Он описывает КАК писать, а
 * не О ЧЁМ: роль, тон, структуру, запреты. У «Отче наш» он был подробный и
 * осмысленный — и именно с ним вышли посты про SMM, потому что единственной
 * содержательной подсказкой в нём осталась роль «SMM-стратег». Считать его темой
 * значит оставить ту же дыру.
 */

/** Служебные слова: сами по себе тему не задают. */
const SERVICE_WORDS = new Set([
  'кампания', 'кампании', 'кампанию', 'кампаний', 'campaign', 'campaigns',
  'тест', 'тестовая', 'тестовый', 'test', 'demo', 'демо', 'проект', 'project',
  'новая', 'новый', 'новое', 'new', 'без', 'название', 'name',
  'для', 'про', 'the', 'and', 'for', 'with', 'что', 'как', 'это',
]);

function words(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Слова, которые действительно что-то говорят о теме. */
function meaningfulWords(value: unknown, exclude: Set<string> = new Set()): string[] {
  return words(value).filter((w) => w.length >= 3 && !SERVICE_WORDS.has(w) && !exclude.has(w));
}

/**
 * Текст отказа, если инструмент вернул ошибку значением, а не исключением.
 * Пустая строка означает «отказа нет» — в том числе когда список пуст честно.
 */
export function toolErrorText(result: any): string {
  if (!result || typeof result !== 'object') return '';
  const err = (result as any).error;
  if (typeof err === 'string') return err.trim();
  if (err instanceof Error) return err.message.trim();
  if (err && typeof err === 'object') {
    const m = (err as any).message;
    if (typeof m === 'string' && m.trim()) return m.trim();
    return 'инструмент вернул ошибку без текста';
  }
  return '';
}

export interface TopicSources {
  /** Ключевые слова кампании — самый прямой источник темы. */
  keywords?: string[];
  /** Имя кампании: из описания вычитается, темой само по себе не считается. */
  campaignName?: string;
  /** Описание кампании. */
  campaignDescription?: string;
  /** Команда запуска — прямое указание человека на этот прогон. */
  launchCommand?: string;
}

/**
 * Есть ли теме откуда взяться. Достаточно одного источника: слова, команда
 * запуска или описание. Имя кампании из описания вычитается — «Кампания Отче
 * наш» не рассказывает о кампании ничего, чего не сказано в её названии.
 */
export function hasUsableTopic(src: TopicSources): boolean {
  const keywords = (src.keywords || []).filter((k) => typeof k === 'string' && k.trim());
  if (keywords.length > 0) return true;

  if (meaningfulWords(src.launchCommand).length >= 2) return true;

  const nameWords = new Set(words(src.campaignName));
  if (meaningfulWords(src.campaignDescription, nameWords).length >= 2) return true;

  return false;
}
