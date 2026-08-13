/**
 * AI-110: Универсальный форматтер ошибок для провайдеров API.
 *
 * Превращает сырой объект ошибки в человекочитаемую строку, извлекая:
 * - описание из response.data (error_msg, error.message, description)
 * - HTTP-статус
 * - код ошибки (code, error_code)
 * - syscall/address/port для сетевых ошибок
 * - AggregateError (перебор адресов)
 *
 * Обязан возвращать непустую строку всегда.
 */
export function describeApiError(err: any, provider: string = 'API'): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
    if (s && !parts.includes(s)) parts.push(s);
  };

  // 1. Описание из response.data (разные провайдеры — разные поля)
  const data = err?.response?.data;
  if (data && typeof data === 'object') {
    push(data.description);           // Telegram
    push(data.error?.error_msg);      // VK
    push(data.error?.message);        // VK alt
    push(data.error_description);     // OAuth
    if (typeof data.error === 'string') push(data.error);  // VK string error
  }

  // 2. HTTP статус
  const status = err?.response?.status;
  if (status) push(`HTTP ${status}`);

  // 3. Код ошибки
  const cause = err?.cause || {};
  const code = err?.code || cause.code || err?.response?.data?.error_code || err?.response?.data?.error?.error_code;
  push(code);

  // 4. Сетевая информация
  const syscall = err?.syscall || cause.syscall;
  const address = err?.address || cause.address;
  const port = err?.port ?? cause.port;
  if (syscall || address) {
    push([syscall, address ? (port ? `${address}:${port}` : address) : ''].filter(Boolean).join(' '));
  }

  // 5. AggregateError (перебор адресов)
  const inner = Array.isArray(err?.errors) ? err.errors : [];
  for (const e of inner) push(e?.message || e?.code);

  // 6. Собственное сообщение (последний приоритет — чтобы не дублировать)
  push(err?.message);
  push(cause.message);

  return parts.join(' | ') || `${provider}: ошибка без текста (тип: ${err?.constructor?.name || typeof err})`;
}
