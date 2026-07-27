/**
 * Одноразовость ссылок сброса пароля.
 *
 * Сам токен остаётся подписанным HMAC — это защита от подделки. Но подпись
 * ничего не знает о том, воспользовались ссылкой или нет, поэтому чистый
 * HMAC(userId:ts) живёт весь свой TTL и срабатывает сколько угодно раз.
 * Здесь лежит серверное состояние, которое делает ссылку одноразовой:
 * выданный токен запоминается, при использовании гасится, при любой смене
 * пароля гасятся все токены пользователя.
 *
 * Почему Map, а не коллекция в Directus: состояние живёт максимум час, новой
 * схемы и прав на прод не требует. Хранилище выбрано по образцу
 * utils/temp-video-store.ts.
 *
 * Поведение при рестарте: хранилище пустеет, и все выданные ссылки перестают
 * работать. Это fail-closed — рестарт ссылки гасит, а не воскрешает.
 * Плата за это — пользователю нужно запросить письмо заново; для сброса
 * пароля такой размен правильный.
 *
 * Важно: состояние процессное. При нескольких инстансах приложения ссылка
 * будет валидна только на том, что её выдал.
 */

interface ResetTokenEntry {
  userId: string;
  expiresAt: number;
}

const issuedTokens = new Map<string, ResetTokenEntry>();

function purgeExpired(now = Date.now()): void {
  for (const [token, entry] of issuedTokens) {
    if (entry.expiresAt <= now) issuedTokens.delete(token);
  }
}

/**
 * Запоминает только что выданный токен. Предыдущие ссылки того же
 * пользователя гасятся: актуальной остаётся последняя запрошенная.
 */
export function rememberResetToken(token: string, userId: string, ttlSec: number): void {
  purgeExpired();
  invalidateUserResetTokens(userId);
  issuedTokens.set(token, { userId, expiresAt: Date.now() + ttlSec * 1000 });
}

/**
 * Гасит токен и сообщает, был ли он вообще действителен.
 * Повторный вызов с тем же токеном вернёт false — в этом вся одноразовость.
 */
export function consumeResetToken(token: string, userId: string): boolean {
  purgeExpired();
  const entry = issuedTokens.get(token);
  if (!entry) return false;
  if (entry.userId !== userId) return false;
  issuedTokens.delete(token);
  return true;
}

/**
 * Гасит все ссылки пользователя. Вызывается при ЛЮБОЙ смене пароля —
 * и через сброс, и из профиля, — чтобы уже отправленное письмо не осталось
 * рабочим ключом к аккаунту.
 */
export function invalidateUserResetTokens(userId: string): number {
  let removed = 0;
  for (const [token, entry] of issuedTokens) {
    if (entry.userId === userId) {
      issuedTokens.delete(token);
      removed += 1;
    }
  }
  return removed;
}

/** Только для тестов: полная очистка хранилища. */
export function __clearResetTokenStore(): void {
  issuedTokens.clear();
}

// Периодическая уборка просроченного. unref, чтобы таймер не держал процесс
// (и не подвешивал тестовый ран).
const cleanupTimer = setInterval(() => purgeExpired(), 10 * 60 * 1000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
