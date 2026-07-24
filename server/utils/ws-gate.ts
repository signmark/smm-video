/**
 * Security §5 (2026-07-24), временная мера (low): /ws отдаёт публикационные события
 * ВСЕХ пользователей любому неаутентифицированному клиенту. До полноценной изоляции
 * (валидация Directus-сессии на upgrade, привязка socket к user/tenant, проверка Origin —
 * medium-вариант §5) WebSocket в production закрыт.
 *
 * Override для контролируемого включения: WS_PUBLIC_EVENTS_ENABLED=true (осознанное
 * решение owner'а, не дефолт).
 */
export function isWsAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return env.WS_PUBLIC_EVENTS_ENABLED === 'true';
}
