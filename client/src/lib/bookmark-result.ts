/**
 * Разбор ответа PATCH /api/campaign-trends/:id/bookmark (AI-52).
 *
 * Ручка отвечает конвертом `{ success, data: { id, is_bookmarked, ... } }`, а
 * клиент читал `is_bookmarked` и `id` у самого конверта. Там их нет, выходил
 * `undefined`, и дальше он ложен во всех трёх местах сразу: тост всегда
 * «удалено», кеш обновлялся значением `undefined`, а сравнение
 * `topic.id === data.id` не совпадало ни с чем — список не обновлялся вовсе.
 * Пользователь видел одинаковую реакцию на добавление и на удаление.
 *
 * Сервер намеренно не трогаем: конверт `{ success, data }` общий с соседними
 * ручками, менять его ради одного места хуже. Распаковываем здесь и терпим обе
 * формы — на случай, если ручка когда-нибудь начнёт отвечать плоско.
 */
export interface BookmarkResult {
  id?: string;
  isBookmarked: boolean;
}

function unwrap(payload: unknown): Record<string, unknown> {
  const envelope = (payload ?? {}) as Record<string, unknown>;
  const inner = envelope.data;
  return (inner && typeof inner === 'object' ? inner : envelope) as Record<string, unknown>;
}

export function readBookmarkResult(payload: unknown): BookmarkResult {
  const inner = unwrap(payload);
  const rawFlag = inner.is_bookmarked ?? inner.isBookmarked;

  return {
    id: typeof inner.id === 'string' ? inner.id : undefined,
    // Только настоящий boolean считается ответом. Всё остальное — не «нет», а
    // «сервер не сказал»: показать пользователю обратное действие хуже, чем
    // честно сообщить об ошибке (см. hasBookmarkState).
    isBookmarked: rawFlag === true,
  };
}

/** Сервер вообще сообщил состояние закладки? */
export function hasBookmarkState(payload: unknown): boolean {
  const rawFlag = unwrap(payload).is_bookmarked ?? unwrap(payload).isBookmarked;
  return typeof rawFlag === 'boolean';
}
