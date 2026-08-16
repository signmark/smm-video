import {
  FAILED_PUBLICATION_DOT_COLOR,
  MEDIA_KIND_DOT_COLOR,
  MEDIA_KIND_LABEL,
  type ContentMediaKind,
} from '@/lib/calendar-dot-color';

/**
 * Легенда цветных маркеров под календарём (AI-116).
 *
 * Почему её не было и почему теперь есть: договорённость о цветах жила только
 * в коде, проверить её глазами было нельзя — владелец 16.08 спросил, что
 * означают цвета, и оказался прав в главном (красный должен значить ошибку) и
 * неправ в частности (красным было видео).
 *
 * Легенда СОБИРАЕТСЯ ИЗ ТЕХ ЖЕ КОНСТАНТ, что и сами маркеры. Это не украшение,
 * а защита: подпись, набранная отдельными литералами, разъезжается с
 * поведением при первой же правке цвета и начинает врать авторитетно.
 *
 * Порядок: сначала неудача — это то, что человек ищет глазами.
 *
 * ОФОРМЛЕНИЕ (просьба владельца 16.08): легенда должна быть на видном месте и
 * отличаться от остального текста, но не тянуть внимание на себя. Отсюда
 * компромисс: отдельная рамка с приглушённым фоном и заголовок разрядкой —
 * блок читается как служебный, а не как часть содержимого страницы. Точки в
 * легенде того же размера, что и в ячейках дня: если сделать их крупнее,
 * человек перестаёт узнавать в них те же самые маркеры.
 */
const MEDIA_ORDER: ContentMediaKind[] = ['video', 'image', 'text'];

export function CalendarLegend({ withFailed = true }: { withFailed?: boolean }) {
  return (
    <div
      className="mt-3 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2"
      data-testid="calendar-legend"
    >
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        Обозначения
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {withFailed && (
          <span className="flex items-center gap-1.5" data-testid="calendar-legend-failed">
            <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${FAILED_PUBLICATION_DOT_COLOR}`} />
            не опубликовалось
          </span>
        )}
        {MEDIA_ORDER.map((kind) => (
          <span key={kind} className="flex items-center gap-1.5" data-testid={`calendar-legend-${kind}`}>
            <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${MEDIA_KIND_DOT_COLOR[kind]}`} />
            {MEDIA_KIND_LABEL[kind]}
          </span>
        ))}
      </div>
    </div>
  );
}
