/**
 * Текст отказа площадки, который никогда не бывает пустым.
 *
 * Зачем. Причина отказа собиралась как `err.response?.data?.error?.message ||
 * err.message`. Если площадка ответила отказом без текста, обе части пусты — и в
 * журнал уходила строка «[Instagram] Ошибка: » с пустотой после двоеточия, а
 * человеку показывалась общая фраза «Ошибка Instagram API». 19.08 так и вышло:
 * публикация упала на создании контейнера Reels, и причина потерялась целиком —
 * ни человек, ни разработчик не могли узнать, что не понравилось площадке.
 *
 * Правило: пустая строка — не допустимый результат. Если текста нет, говорим то,
 * что знаем: на каком шаге, с каким кодом ответа и типом ошибки, в какой операции.
 * «Площадка отказала без объяснения» — тоже осмысленный ответ, в отличие от пустоты.
 */

export interface PlatformErrorContext {
  /** Как называть площадку человеку: «Instagram», «Facebook», «Threads». */
  platform: string;
  /** Что мы делали: «создание контейнера Reels», «публикация», «проверка доступа». */
  step?: string;
  /** Идентификатор операции из журнала — по нему находят весь ход попытки. */
  opId?: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Собирает то, что известно об отказе, когда текста площадка не дала. */
function knownFacts(err: any, ctx: PlatformErrorContext): string[] {
  const facts: string[] = [];
  if (ctx.step) facts.push(`шаг: ${ctx.step}`);

  const status = err?.response?.status;
  if (typeof status === 'number') facts.push(`ответ ${status}`);

  const apiError = err?.response?.data?.error;
  if (apiError && typeof apiError === 'object') {
    const type = text(apiError.type);
    if (type) facts.push(`тип ${type}`);
    if (apiError.code !== undefined && apiError.code !== null) facts.push(`код ${apiError.code}`);
    if (apiError.error_subcode) facts.push(`подкод ${apiError.error_subcode}`);
  }

  const code = text(err?.code);
  if (code) facts.push(`код соединения ${code}`);

  if (ctx.opId) facts.push(`операция ${ctx.opId}`);
  return facts;
}

export function describePlatformError(err: any, ctx: PlatformErrorContext): string {
  const apiError = err?.response?.data?.error;

  // 1. Обычный текст ошибки площадки.
  const message = text(apiError?.message);
  if (message) return message;

  // 2. Meta отдаёт человеку отдельные поля — они понятнее технического message.
  const userTitle = text(apiError?.error_user_title);
  const userMsg = text(apiError?.error_user_msg);
  if (userTitle || userMsg) return [userTitle, userMsg].filter(Boolean).join(': ');

  // 3. Иногда ошибка приходит просто строкой.
  const plainApiError = text(err?.response?.data?.error);
  if (plainApiError) return plainApiError;

  // 4. Текст самого исключения.
  const own = text(err?.message);
  if (own) return own;

  // 5. Текста нет. Говорим то, что знаем, — но не молчим.
  const facts = knownFacts(err, ctx);
  const tail = facts.length ? ` (${facts.join(', ')})` : '';
  return `${ctx.platform} отказал без объяснения${tail}`;
}
