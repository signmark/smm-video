/**
 * Классификатор ответов VK API.
 *
 * VK отвечает отказом по десятку принципиально разных причин, и раньше все они
 * попадали в UI одинаково — красным тостом «Ошибка». Пользователь не мог
 * отличить «VK сейчас лежит, зайдите через 10 минут» от «токен мёртв,
 * переподключите» и от «ваше VK-приложение заблокировано, переподключение не
 * поможет». Замер 29.07.2026 на живых токенах кампаний — четыре разные причины
 * в одну минуту:
 *   10 «Internal server error: could not check access_token now, check later»
 *    5 «User authorization failed: invalid access_token»
 *    8 «Invalid request: Application is blocked»
 *   15 «Access denied: token required»
 *
 * Классификатор превращает ответ VK в вердикт с тремя полями, которые нужны
 * вызывающему коду: что это за причина, ждать ли (`retryable`) и каким тоном
 * говорить пользователю (`severity`).
 *
 * ВАЖНО: `kind === 'auth_expired'` — единственное основание выставлять
 * `authExpired` кампании. Флаг дорогой: шлёт владельцу письмо и выключает
 * кампанию из refresh cron.
 */

export type VkErrorKind =
  /** VK временно не может ответить — само пройдёт, действий не требует. */
  | 'transient'
  /** Учётные данные мертвы — нужно переподключение. */
  | 'auth_expired'
  /** Заблокировано само VK-приложение — переподключение НЕ поможет. */
  | 'app_blocked'
  /** Токен жив, но прав на этот объект нет. */
  | 'access_denied'
  /** Мы отправили некорректные параметры — баг или кривые настройки. */
  | 'invalid_params'
  /** VK требует капчу — автоматически не решаемо. */
  | 'captcha'
  /** Причина не распознана. */
  | 'unknown';

export interface VkErrorVerdict {
  kind: VkErrorKind;
  /** `warning` — жёлтым «подождите»; `error` — красным, нужно действие. */
  severity: 'warning' | 'error';
  /** Имеет ли смысл повторить тот же запрос позже. */
  retryable: boolean;
  /** Код VK, если он был в ответе. */
  code?: number;
  /** Текст для пользователя — на русском, без внутренностей и токенов. */
  userMessage: string;
}

/**
 * Коды, при которых VK сам сообщает, что не смог обработать запрос сейчас.
 *   1  — Unknown error occurred
 *   6  — Too many requests per second
 *   9  — Flood control
 *   10 — Internal server error: could not check access_token now, check later
 */
const TRANSIENT_CODES = new Set([1, 6, 9, 10]);

/**
 * «…authorization failed» — учётные данные мертвы и сами не починятся.
 * Ровно этот список раньше жил в validation-routes как
 * VK_PERMANENT_AUTH_ERROR_CODES.
 */
const AUTH_EXPIRED_CODES = new Set([5, 27, 28]);

/**
 * 15 (Access denied) и 7 (Permission denied) означают отказ по конкретному
 * объекту и смерть токена НЕ доказывают — иначе кампания с урезанными правами
 * получала бы ложное «требует переподключения».
 */
const ACCESS_DENIED_CODES = new Set([7, 15, 203]);

/** Кривые параметры запроса: 100 — invalid parameter, 125 — invalid group id. */
const INVALID_PARAMS_CODES = new Set([100, 113, 125]);

const MESSAGES: Record<VkErrorKind, string> = {
  transient: 'ВКонтакте сейчас не отвечает на проверку — это временно на стороне VK. Подключение не тронуто, проверим ещё раз автоматически.',
  auth_expired: 'Доступ ВКонтакте истёк — нужно переподключить сообщество.',
  app_blocked: 'VK-приложение заблокировано на стороне ВКонтакте. Переподключение не поможет — нужно разбираться в кабинете разработчика VK.',
  access_denied: 'ВКонтакте отказал в доступе к этому объекту. Токен жив, но прав не хватает — проверьте права в сообществе.',
  invalid_params: 'ВКонтакте отклонил параметры запроса — проверьте ID сообщества в настройках.',
  captcha: 'ВКонтакте запросил капчу. Повторите через несколько минут.',
  unknown: 'ВКонтакте вернул неожиданный ответ.',
};

const VERDICTS: Record<VkErrorKind, Omit<VkErrorVerdict, 'code'>> = {
  transient: { kind: 'transient', severity: 'warning', retryable: true, userMessage: MESSAGES.transient },
  auth_expired: { kind: 'auth_expired', severity: 'error', retryable: false, userMessage: MESSAGES.auth_expired },
  app_blocked: { kind: 'app_blocked', severity: 'error', retryable: false, userMessage: MESSAGES.app_blocked },
  access_denied: { kind: 'access_denied', severity: 'error', retryable: false, userMessage: MESSAGES.access_denied },
  invalid_params: { kind: 'invalid_params', severity: 'error', retryable: false, userMessage: MESSAGES.invalid_params },
  captcha: { kind: 'captcha', severity: 'warning', retryable: true, userMessage: MESSAGES.captcha },
  unknown: { kind: 'unknown', severity: 'error', retryable: false, userMessage: MESSAGES.unknown },
};

const verdict = (kind: VkErrorKind, code?: number): VkErrorVerdict =>
  code === undefined ? { ...VERDICTS[kind] } : { ...VERDICTS[kind], code };

/** Достаёт `{ error_code, error_msg }` из любой формы, в которой он к нам приходит. */
function extractVkError(input: any): { code?: number; msg: string } | null {
  if (!input || typeof input !== 'object') return null;

  // Наш валидатор кладёт провал проверки группы в отдельное поле.
  const candidates = [input.error, input.groupError?.error, input.groupError, input.response?.data?.error];
  for (const candidate of candidates) {
    if (candidate && typeof candidate.error_code === 'number') {
      return { code: candidate.error_code, msg: String(candidate.error_msg || '') };
    }
  }
  if (typeof input.error_code === 'number') {
    return { code: input.error_code, msg: String(input.error_msg || '') };
  }
  return null;
}

/**
 * Классифицирует отказ VK.
 *
 * @param input тело ответа VK (`{ error: {...} }`), `details` от валидатора или
 *   пойманная axios-ошибка
 */
export function classifyVkError(input: any): VkErrorVerdict {
  const vkError = extractVkError(input);

  if (vkError?.code !== undefined) {
    const { code, msg } = vkError;

    if (TRANSIENT_CODES.has(code)) return verdict('transient', code);
    if (AUTH_EXPIRED_CODES.has(code)) return verdict('auth_expired', code);
    if (code === 14) return verdict('captcha', code);
    if (code === 2) return verdict('app_blocked', code);

    // 8 — общий «Invalid request», и только текст отличает блокировку
    // приложения от кривых параметров. Другого признака VK не даёт.
    if (code === 8) {
      return /application is blocked/i.test(msg)
        ? verdict('app_blocked', code)
        : verdict('invalid_params', code);
    }

    if (ACCESS_DENIED_CODES.has(code)) return verdict('access_denied', code);
    if (INVALID_PARAMS_CODES.has(code)) return verdict('invalid_params', code);

    return verdict('unknown', code);
  }

  // Транспорт: сеть, таймаут, 5xx и 429 — VK не ответил по существу.
  const status: number | undefined = input?.response?.status;
  if (typeof status === 'number' && (status >= 500 || status === 429)) {
    return verdict('transient');
  }
  const transportCode = input?.code;
  if (transportCode === 'ECONNABORTED' || transportCode === 'ETIMEDOUT'
    || transportCode === 'ECONNRESET' || transportCode === 'ENOTFOUND'
    || transportCode === 'EAI_AGAIN') {
    return verdict('transient');
  }

  return verdict('unknown');
}

/**
 * Мёртв ли сохранённый токен по этому ответу.
 *
 * Единственный разрешённый повод выставить кампании `authExpired`. Отдельная
 * функция, чтобы условие не расползалось по вызывающим местам.
 */
export function isVkAuthExpired(details: any): boolean {
  if (!details || typeof details !== 'object') return false;
  // users.get прошёл (есть `user`) — токен как раз рабочий, мертва проверка
  // группы. Такой details про смерть credential ничего не говорит.
  if (details.groupError !== undefined) return false;
  if (details.user !== undefined) return false;
  return classifyVkError(details).kind === 'auth_expired';
}
