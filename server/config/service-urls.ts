/**
 * AI-89 — единый источник URL внешних сервисов.
 *
 * ЗАЧЕМ. До #89 в server/ было 36 мест с конструкцией вида
 * `process.env.DIRECTUS_URL || 'https://directus.nplanner.ru'`.
 * Пока переменная задана, запасное значение не работает. Но во
 * второй установке, если переменная потеряется, приложение
 * МОЛЧА уйдёт в базу первой установки и начнёт писать чужие
 * данные. Тихий уход к чужому серверу хуже падения: падение
 * видно сразу.
 *
 * Этот модуль:
 *  1. Читает переменные окружения один раз при импорте.
 *  2. Если обязательная переменная не задана — бросает сразу
 *     с понятным сообщением. Никаких «silent fallback».
 *  3. Если задана — выдаёт значение в виде строки.
 *  4. Тест в `service-urls.test.ts` проверяет обе ветки; тест
 *     на соответствие `deploy/.env.example` живёт в
 *     `service-urls-env-sync.test.ts`.
 *
 * ОГРАНИЧЕНИЯ.
 *  — Не кэшируется: модуль читает env в момент первого обращения,
 *    а не при импорте, чтобы тесты могли подменять `process.env`
 *    через `vi.stubEnv`. Для production это означает, что
 *    смена переменной в рантайме не подхватится без перезапуска —
 *    это желаемое поведение для fail-fast: если кто-то меняет
 *    переменную на лету, мы хотим, чтобы приложение перезапустилось
 *    и прошло проверку заново.
 *  — Текущий список обязательных переменных зафиксирован в
 *    `REQUIRED_VARS` ниже. Если добавляете новую обязательную
 *    переменную — добавьте её сюда И в `deploy/.env.example`,
 *    иначе тест `service-urls-env-sync.test.ts` покраснеет.
 */

export type ServiceUrlKey =
  | 'DIRECTUS_URL'
  | 'DIRECTUS_PUBLIC_URL'
  | 'SMM_HOST'
  | 'APP_PUBLIC_URL'
  | 'OMEMO_POSTBACK_URL';

export const REQUIRED_VARS: readonly ServiceUrlKey[] = [
  'DIRECTUS_URL',
  'DIRECTUS_PUBLIC_URL',
  'SMM_HOST',
  'APP_PUBLIC_URL',
  'OMEMO_POSTBACK_URL',
] as const;

/**
 * Чтение обязательной переменной. Если не задана — бросает Error
 * с понятным сообщением. Кэша нет: читает каждый раз, чтобы
 * можно было подменять `process.env` в тестах.
 */
export function getRequiredServiceUrl(key: ServiceUrlKey): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    // Перечисляем все обязательные переменные в сообщении, чтобы
    // оператор сразу увидел, что ещё может быть не задано.
    const others = REQUIRED_VARS.filter((k) => k !== key).join(', ');
    throw new Error(
      `[service-urls] Required env ${key} is not set. ` +
      `Without it the app would silently fall back to a first-installation ` +
      `URL and start writing data to the wrong server. ` +
      `Set ${key} (and ${others}) in the environment, e.g. via .env.`
    );
  }
  return value;
}

/**
 * Чтение необязательного URL. Если не задана — возвращает null.
 * Используется для переменных, у которых нет «безопасного» дефолта:
 * лучше явно вернуть null и пусть вызывающий код решит, что делать.
 */
export function getOptionalServiceUrl(key: string): string | null {
  const value = process.env[key];
  if (!value || !value.trim()) return null;
  return value;
}

/**
 * Само-валидация на старте. Вызывается из `server/index.ts`
 * ДО открытия порта. Если хоть одна обязательная переменная не
 * задана — приложение падает с понятным сообщением.
 *
 * ЗАЧЕМ отдельная функция, а не просто вызов getRequiredServiceUrl
 * в каждом файле:
 *   1. Одна точка входа для fail-fast на старте.
 *   2. Можно вызвать из unit-теста, не поднимая HTTP.
 *   3. В будущем легко добавить проверку URL-формата
 *      (например `new URL(value)`) — одна правка.
 */
export function validateRequiredServiceUrls(): void {
  const missing: ServiceUrlKey[] = [];
  for (const key of REQUIRED_VARS) {
    if (!process.env[key] || !process.env[key]!.trim()) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[service-urls] Missing required env variables: ${missing.join(', ')}. ` +
      `Refusing to start: silent fallback to a first-installation URL ` +
      `would write data to the wrong server. ` +
      `Copy deploy/.env.example to .env and fill in the values.`
    );
  }
}
