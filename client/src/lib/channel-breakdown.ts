/**
 * SM-15, решение владельца 19.08: «Хорошо бы написать, посты из какой кампании
 * учтены».
 *
 * Рядом с метрикой кампании стоит вторая цифра — по всему каналу за тот же
 * период. Разница между ними была безымянной, и человек не мог понять, чья это
 * активность. Здесь разница раскладывается на слагаемые: сама кампания,
 * поимённо соседние кампании того же канала и остаток, который по данным
 * канала опознать нельзя.
 *
 * Правило вынесено из страницы отдельно, чтобы проверялось тестом: числа в
 * подсказке обязаны сходиться с числом, которое человек видит рядом.
 */

export type ChannelMetric = 'posts' | 'views' | 'likes' | 'comments' | 'shares';

export interface MetricValues {
  posts: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface ChannelAttribution {
  campaignName: string;
  own: MetricValues;
  others: Array<MetricValues & { campaignId: string; name: string }>;
  unattributed: MetricValues;
}

export type BreakdownPart =
  | { kind: 'own'; name: string; value: number }
  | { kind: 'other'; campaignId: string; name: string; value: number }
  | { kind: 'unattributed'; value: number };

/**
 * Слагаемые для одной метрики. Нулевые не показываем: строка «0 — кампания
 * „Зимняя“» ничего не объясняет и вытесняет то, что объясняет.
 */
export function channelBreakdownParts(
  metric: ChannelMetric,
  attribution: ChannelAttribution | undefined,
): BreakdownPart[] {
  if (!attribution) return [];

  const parts: BreakdownPart[] = [];
  if (attribution.own[metric] > 0) {
    parts.push({ kind: 'own', name: attribution.campaignName, value: attribution.own[metric] });
  }

  attribution.others
    .filter(other => other[metric] > 0)
    .sort((a, b) => b[metric] - a[metric])
    .forEach(other => parts.push({
      kind: 'other',
      campaignId: other.campaignId,
      name: other.name,
      value: other[metric],
    }));

  if (attribution.unattributed[metric] > 0) {
    parts.push({ kind: 'unattributed', value: attribution.unattributed[metric] });
  }

  return parts;
}

/**
 * Показывать разложение стоит только там, где оно что-то добавляет: если всё
 * число и так принадлежит текущей кампании, объяснять нечего.
 */
export function hasMeaningfulBreakdown(
  metric: ChannelMetric,
  attribution: ChannelAttribution | undefined,
): boolean {
  const parts = channelBreakdownParts(metric, attribution);
  return parts.some(part => part.kind !== 'own');
}
