import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  channelBreakdownParts,
  hasMeaningfulBreakdown,
  type ChannelAttribution,
  type ChannelMetric,
} from '@/lib/channel-breakdown';

/**
 * AI-81: вторая цифра — та же метрика по всему каналу за период.
 *
 * Показывается ТОЛЬКО когда она отличается от кампанийной. Если совпадает,
 * сравнивать не с чем, а лишнее число рядом с каждой метрикой читается как шум
 * и обесценивает те случаи, когда расхождение действительно есть.
 *
 * SM-15, 19.08. Подпись раньше объясняла расхождение ручными публикациями мимо
 * системы. Замер по боевой базе показал, что это третий по значимости источник
 * из трёх: шесть каналов ведут по две-три кампании сразу (посты соседней
 * кампании в эту аналитику не попадают, и правильно), а 67 опубликованных
 * записей из 2862 не сохранили идентификатор поста и уже не сопоставимы с
 * каналом никогда. Поэтому подпись перечисляет все три источника, а первая
 * цифра остаётся: она единственная говорит про САМУ кампанию.
 *
 * Отсутствие `channel` (нет пост-уровневой атрибуции) — тоже причина молчать:
 * подставить ноль или продублировать нашу цифру значило бы выдумать данные.
 */
export function ChannelTotal({
  own,
  channel,
  metric,
  attribution,
}: {
  own: number;
  channel?: number;
  metric: ChannelMetric;
  attribution?: ChannelAttribution;
}) {
  const { t } = useTranslation();
  if (channel === undefined || channel === own) return null;

  // SM-15, решение владельца 19.08: «Хорошо бы написать, посты из какой
  // кампании учтены». Разница между цифрами была безымянной — теперь в
  // подсказке она разложена поимённо.
  const parts = hasMeaningfulBreakdown(metric, attribution)
    ? channelBreakdownParts(metric, attribution)
    : [];

  const lines = parts.map(part => {
    const value = part.value.toLocaleString();
    if (part.kind === 'own') return t('analytics.channelBreakdownOwn', { value, name: part.name });
    if (part.kind === 'other') return t('analytics.channelBreakdownOther', { value, name: part.name });
    return t('analytics.channelBreakdownUnattributed', { value });
  });

  const hint = lines.length
    ? [t('analytics.channelBreakdownIntro'), ...lines].join('\n')
    : t('analytics.channelHint');

  // Наведение курсора на телефоне не существует: подсказка, доступная только
  // по hover, там не открывается вовсе — владелец это и увидел. Поэтому цифра
  // сама по себе кнопка: нажатие открывает то же объяснение, а `title`
  // остаётся для тех, кто работает мышью.
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground text-xs underline decoration-dotted underline-offset-2 cursor-pointer"
          title={hint}
          aria-label={hint}
          data-testid="channel-total"
        >
          ({t('analytics.channelValue', { value: channel.toLocaleString() })})
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-xs" data-testid="channel-total-details">
        {lines.length ? (
          <>
            <p className="font-medium mb-1">{t('analytics.channelBreakdownIntro')}</p>
            <ul className="space-y-1">
              {lines.map((line, index) => (
                <li key={index} data-testid="channel-total-line">{line}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>{t('analytics.channelHint')}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
