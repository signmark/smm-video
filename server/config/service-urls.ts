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
 *  1. Читает переменные окружения каждый раз при вызове
 *     `getRequiredServiceUrl`/`getOptionalServiceUrl`, а не при
 *     импорте модуля. Это нужно, чтобы тесты могли подменять
 *     `process.env` через `vi.stubEnv` без перезапуска процесса.
 *     В production переменные не меняются в рантайме, поэтому
 *     «каждый раз» == «один раз при первом обращении».
 *  2. Если обязательная переменная не задана — бросает сразу
 *     с понятным сообщением. Никаких «silent fallback».
 *  3. Если задана — выдаёт значение в виде строки.
 *
 * ДВА СПИСКА, А НЕ ОДИН.
 * `REQUIRED_VARS` — переменные, без которых приложение ПИШЕТ
 * (или иначе СОВЕРШАЕТ ДЕЙСТВИЕ) во внешнюю систему. Если такой
 * переменной нет — fail-fast на старте через
 * `validateRequiredServiceUrls()`.
 * `OPTIONAL_VARS` — переменные, которые сервер может читать, но
 * для которых в коде есть осмысленная цепочка источников
 * (старые имена для совместимости, Replit-домен, и т.п.). Их
 * отсутствие НЕ ломает старт — только меняет рантайм-поведение.
 *
 * Почему SMM_HOST не в REQUIRED_VARS. В deploy/.env.example
 * SMM_HOST задаётся, но в server/ его не читает НИКТО: это
 * переменная compose и Traefik, она используется DNS-уровнем
 * ниже. Включить её в REQUIRED_VARS — значит требовать
 * обязательную переменную, которую наш код не потребляет, и
 * отказывать в старте, когда причина не у нас. Это вводит
 * в заблуждение и в этом смысле хуже, чем отсутствие проверки.
 *
 * Почему APP_PUBLIC_URL не в REQUIRED_VARS. У неё есть
 * несколько осмысленных источников (`APP_PUBLIC_URL`,
 * `API_BASE_URL`, `PUBLIC_URL`, `APP_URL`, `SMM_DOMAIN`,
 * `REPLIT_DEV_DOMAIN`), и сервер не «пишет» по этому URL
 * (только строит ссылки для прокси видео). Если её нет — мы
 * возвращаемся к оригинальному URL и логируем; это не «уход в
 * чужой домен», это «нет локального прокси». Не fail-fast
 * случай.
 *
 * Тесты:
 *  — `service-urls.test.ts` — поведение `getRequiredServiceUrl`
 *    при отсутствии/наличии переменной, мутационно-устойчиво.
 *  — `service-urls-env-sync.test.ts` — синхронность
 *    `REQUIRED_VARS` и `deploy/.env.example`. Если добавляете
 *    обязательную переменную сюда — добавьте её и в env.example,
 *    иначе этот тест покраснеет.
 */

export type ServiceUrlKey =
  | 'DIRECTUS_URL'
  | 'DIRECTUS_PUBLIC_URL'
  | 'OMEMO_POSTBACK_URL';

export type OptionalServiceUrlKey =
  | 'SMM_HOST'
  | 'APP_PUBLIC_URL';

/**
 * Переменные, отсутствие которых = fail-fast на старте.
 * Сервер ПИШЕТ по этим адресам (или делает ответственное
 * действие), и запасное значение первой установки = молчаливый
 * уход в чужой домен.
 */
export const REQUIRED_VARS: readonly ServiceUrlKey[] = [
  'DIRECTUS_URL',          // каждый CRUD-запрос
  'DIRECTUS_PUBLIC_URL',  // что отдаём браузеру через /api/config
  'OMEMO_POSTBACK_URL',   // постбэк партнёру о конверсии
] as const;

/**
 * Переменные, которые мы знаем и читаем, но для которых
 * сервер не делает fail-fast: либо есть осмысленная цепочка
 * источников (APP_PUBLIC_URL), либо сервер их в принципе
 * не потребляет (SMM_HOST — это compose/Traefik).
 */
export const OPTIONAL_VARS: readonly OptionalServiceUrlKey[] = [
  'SMM_HOST',
  'APP_PUBLIC_URL',
] as const;

/**
 * Чтение обязательной переменной. Если не задана — бросает Error
 * с понятным сообщением. Кэша нет: читает каждый вызов, чтобы
 * можно было подменять `process.env` в тестах через `vi.stubEnv`.
 */
export function getRequiredServiceUrl(key: ServiceUrlKey): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
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
 * Используется для переменных, у которых есть цепочка источников:
 * `getOptionalServiceUrl('APP_PUBLIC_URL')` — первый шаг такой
 * цепочки, а дальше вызывающий код решает, что делать с null.
 */
export function getOptionalServiceUrl(key: OptionalServiceUrlKey): string | null {
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