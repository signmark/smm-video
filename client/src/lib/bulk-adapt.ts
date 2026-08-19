/**
 * Массовая адаптация под соцсети: кого трогать нельзя и что честно сказать в итоге.
 *
 * Кнопка пересобирает social_platforms с нуля — все площадки получают статус
 * «ожидает», а идентификатор поста, ссылка и время публикации обнуляются. Для
 * опубликованного или запланированного поста это стирает запись о публикации
 * внутри продукта: сам пост в соцсети останется, но продукт про него забудет.
 * Поэтому такие посты пропускаем, а в итоговом сообщении говорим сколько и почему.
 */

/** Статусы, при которых пересборка версий для соцсетей теряет данные. */
const PROTECTED_STATUSES = new Set([
  'published',
  'partially_published',
  'partial',
  'scheduled',
]);

export function isProtectedFromBulkAdapt(status: unknown): boolean {
  return typeof status === 'string' && PROTECTED_STATUSES.has(status.trim().toLowerCase());
}

export interface BulkAdaptOutcome {
  ok: number;
  total: number;
  /** Пропущены как опубликованные или запланированные. */
  skippedProtected: number;
  /** Пропущены, потому что у поста нет текста. */
  skippedEmpty: number;
  cancelled: boolean;
}

/**
 * Итоговое сообщение. Складывать «пропущено» и «не удалось» в одно число нельзя:
 * пропуск — это сознательная защита, а неудача — повод разбираться.
 */
export function bulkAdaptToastText(outcome: BulkAdaptOutcome): string {
  const { ok, total, skippedProtected, skippedEmpty, cancelled } = outcome;
  const parts: string[] = [
    cancelled
      ? `Адаптация остановлена: обработано ${ok} из ${total} постов, остальные остались выбранными.`
      : `Адаптация завершена: ${ok} из ${total} постов.`,
  ];
  if (skippedProtected > 0) {
    parts.push(
      `Пропущено опубликованных и запланированных: ${skippedProtected} — их версии для соцсетей не тронуты.`,
    );
  }
  if (skippedEmpty > 0) {
    parts.push(`Пропущено без текста: ${skippedEmpty}.`);
  }
  if (!cancelled) {
    const failed = total - ok - skippedProtected - skippedEmpty;
    if (failed > 0) {
      parts.push(`Не удалось: ${failed}.`);
    }
  }
  return parts.join(' ');
}
