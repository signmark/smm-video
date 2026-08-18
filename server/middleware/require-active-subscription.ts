import { Request, Response, NextFunction } from 'express';
import { directusApi } from '../directus';
import { isPublicApiPath } from './api-auth-gate';
import { logEvent } from '../utils/logger';

/**
 * Гейт подписки.
 *
 * Бизнес-правило: у нас есть только пробный период (trial) и платные тарифы.
 * Когда подписка/триал истекли — пользователь НЕ должен иметь возможности
 * что-либо делать (создавать, генерировать, публиковать, изменять, удалять).
 * Единственное исключение — он может ЧИТАТЬ свои данные кампаний (GET-запросы),
 * чтобы сохранить наработки или мигрировать их в другое место.
 *
 * Реализация:
 *  - чтение (GET/HEAD/OPTIONS) — всегда разрешено;
 *  - изменяющие методы (POST/PUT/PATCH/DELETE) — блокируются при истёкшей подписке,
 *    кроме whitelist (авторизация, оплата, заявка на подписку, промокоды),
 *    чтобы пользователь мог продлить доступ;
 *  - публичные callback'и и вебхуки провайдеров — по общему списку
 *    `isPublicApiPath` из `api-auth-gate.ts`;
 *  - администраторы — полный доступ.
 *
 * Идентичность пользователя определяется через сам предъявленный токен
 * (GET /users/me с Bearer токеном) — Directus сам валидирует подпись/срок токена.
 * Мы НЕ доверяем расшифрованному payload JWT (его можно подделать).
 *
 * FAIL-CLOSED (AI-39, security-backlog §6, 2026-07-31)
 * ----------------------------------------------------
 * Раньше гейт пропускал изменяющий запрос в трёх случаях, когда право на
 * действие подтвердить невозможно: при отсутствии токена (`!token → next()`),
 * при любой ошибке проверки (`catch → next()`) и, как следствие, при полной
 * недоступности Directus. Это давало платные функции бесплатно ровно в тот
 * момент, когда проверить их некому.
 *
 * Теперь наоборот: непроверяемая mutation не исполняется.
 *  - нет предъявленной личности → 401, handler не вызывается;
 *  - Directus ответил 401/403 → сессия недействительна → 401;
 *  - сеть/таймаут/429/5xx/неожиданная форма ответа → 503
 *    `SUBSCRIPTION_VALIDATION_UNAVAILABLE`.
 *
 * Прежний аргумент за fail-open (Directus — внешний VPS с известными
 * простоями, жёсткая блокировка ударит по платящим) закрыт кешем: успешная
 * проверка живёт TTL, и краткий простой платящий пользователь не заметит.
 * После истечения TTL простой обязан давать 503 — иначе кеш превращается в
 * тот же fail-open, только отложенный.
 *
 * Наружу причина не детализируется: клиенту сообщается стабильный код, а не
 * ответ upstream.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Префиксы, которые должны работать даже при истёкшей подписке,
// иначе пользователь не сможет вернуться к оплате/продлению.
const ALLOWED_PREFIXES = [
  '/api/auth',          // вход/выход/refresh
  '/api/payments',      // создание/активация платежа ЮКассы
  '/api/subscriptions', // заявка на подписку
  '/api/promo',         // проверка/активация промокода (может продлить доступ)
];

interface StatusEntry {
  expireDate: string | null;
  isAdmin: boolean;
  /**
   * AI-65. Кого именно гейт не пропустил. Без этого поля отказ виден в журнале,
   * но не связывается с остальным путём запроса того же человека.
   */
  userId: string | null;
  at: number;
}

/** Почему проверку не удалось довести до ответа. */
type FailureKind =
  /** Directus явно отверг токен — сессия недействительна. */
  | 'invalid-session'
  /** Directus недоступен или ответил непонятным — решение принять нельзя. */
  | 'unavailable';

class SubscriptionCheckError extends Error {
  constructor(readonly kind: FailureKind) {
    super(`subscription check failed: ${kind}`);
    this.name = 'SubscriptionCheckError';
  }
}

const STATUS_TTL = 60 * 1000;
const statusCache = new Map<string, StatusEntry>();

// Периодическая очистка кеша, чтобы Map не рос бесконечно по токенам
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of statusCache.entries()) {
    if (now - entry.at >= STATUS_TTL) statusCache.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  const cookieToken = (req as any).cookies?.directus_session_token;
  return cookieToken || null;
}

/**
 * Строгий разбор `expire_date` (приёмка AI-39, 2026-07-31).
 *
 * Проверки «это объект» недостаточно: объект правильного типа, но с неверным
 * контрактом полей, проходил насквозь.
 *  - `{}` — поля нет, `?? null` давало «бессрочно». При drift прав в Directus
 *    (поле скрыто) бессрочными становились сразу все.
 *  - `{ expire_date: 'not-a-date' }` — `new Date('not-a-date')` даёт Invalid
 *    Date, и любое сравнение с ним false, то есть неразбираемая дата молча
 *    означала «не истекло».
 *
 * Поле запрашивается явно (`fields=expire_date,...`), поэтому Directus обязан
 * вернуть ключ — со значением `null`, если срока нет. Отсутствие ключа это уже
 * не «бессрочный пользователь», а расхождение схемы или прав, и решение по
 * такому ответу принимать нельзя.
 *
 * Цена строгости: если поле скроют правами, прод получит 503 на все мутации,
 * а не «все бессрочные». Это осознанно — 503 retryable и заметен, тихая
 * бессрочность незаметна.
 */
function readExpireDate(userData: Record<string, unknown>): string | null {
  if (!('expire_date' in userData)) {
    throw new SubscriptionCheckError('unavailable');
  }

  const raw = userData.expire_date;
  if (raw === null) return null; // срок не задан — существующее бизнес-правило

  if (typeof raw !== 'string' || Number.isNaN(new Date(raw).getTime())) {
    throw new SubscriptionCheckError('unavailable');
  }
  return raw;
}

/**
 * Строгий разбор admin-флага (приёмка AI-39, 2026-07-31).
 *
 * Было `!!(userData.is_smm_admin || userData.is_smm_super)`, а строка `'false'`
 * истинна — ответ `{ is_smm_admin: 'false' }` делал пользователя админом и
 * снимал с него гейт целиком. Поэтому админом считается только настоящий
 * `true`; отсутствие и `null` — обычный пользователь; любой другой тип это
 * расхождение контракта, а не «наверное не админ».
 */
function readAdminFlag(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === 'boolean') return raw;
  throw new SubscriptionCheckError('unavailable');
}

/**
 * Статус подписки по токену. Кешируется ТОЛЬКО успешный ответ:
 * кеш ошибок означал бы, что один простой Directus открывает окно на весь TTL.
 *
 * Срок действия здесь не вычисляется — только сохраняется. Сравнение с
 * текущим временем делает вызывающий на каждом запросе, иначе запись из кеша
 * продлевала бы уже наступивший `expire_date`.
 */
async function fetchStatus(token: string): Promise<StatusEntry> {
  const cached = statusCache.get(token);
  if (cached && Date.now() - cached.at < STATUS_TTL) return cached;

  let resp: any;
  try {
    // Валидируем личность через сам токен — Directus отвергнет поддельный/просроченный
    resp = await directusApi.get('/users/me', {
      headers: { Authorization: `Bearer ${token}` },
      params: { fields: 'id,expire_date,is_smm_admin,is_smm_super' },
    });
  } catch (err: any) {
    const status = err?.response?.status;
    // 401/403 — это ответ по существу: токен недействителен. Остальное
    // (сеть, таймаут, 429, 5xx) — отсутствие ответа, а не отказ.
    if (status === 401 || status === 403) {
      throw new SubscriptionCheckError('invalid-session');
    }
    throw new SubscriptionCheckError('unavailable');
  }

  const userData = resp?.data?.data;
  // Ответ без объекта пользователя разобрать нельзя. Трактовать его как
  // «полей нет, значит бессрочно» — это молчаливый fail-open.
  if (!userData || typeof userData !== 'object') {
    throw new SubscriptionCheckError('unavailable');
  }

  // Оба флага разбираются ДО «или», а не внутри него. При
  // `readAdminFlag(a) || readAdminFlag(b)` второй флаг не проверялся вовсе,
  // если первый уже true: `{ is_smm_admin: true, is_smm_super: 'false' }`
  // проходил, хотя контракт заявлен строгим для обоих полей. Эскалации прав
  // это не давало (первый true и так означает админа), но делало проверку
  // контракта зависящей от порядка полей — то есть необъяснимой снаружи.
  const isAdminFlag = readAdminFlag(userData.is_smm_admin);
  const isSuperFlag = readAdminFlag(userData.is_smm_super);

  const entry: StatusEntry = {
    expireDate: readExpireDate(userData),
    isAdmin: isAdminFlag || isSuperFlag,
    // Идентификатор берём только если он пришёл строкой: гейт не должен падать
    // из-за поля, которое не влияет на решение о доступе.
    userId: typeof userData.id === 'string' ? userData.id : null,
    at: Date.now(),
  };
  statusCache.set(token, entry);
  return entry;
}

/**
 * AI-65. Путь без подставленных идентификаторов.
 *
 * В журнал нельзя писать `/api/campaigns/<uuid>`: это чужой идентификатор в
 * общем потоке логов, и по условию задачи в событиях допускается только шаблон
 * маршрута. Шаблона у общего middleware нет — Express разбирает маршрут позже,
 * — поэтому собираем его сами: всё, что похоже на идентификатор, заменяется.
 */
export function routeTemplate(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
      if (/^\d+$/.test(seg)) return ':id';
      // Длинная строка без разделителей — почти всегда идентификатор или токен.
      if (seg.length > 24 && !seg.includes('.') && !seg.includes('-')) return ':id';
      return seg;
    })
    .join('/');
}

/**
 * AI-65. Единственное место, где гейт отказывает.
 *
 * Раньше все пять отказов уходили только в ответ клиенту и в журнале не
 * оставляли ничего. На вопрос «почему у человека не сработала кнопка» ответа не
 * было: 401 от гейта, 401 от истёкшей сессии и 503 от недоступной проверки
 * снаружи выглядят одинаково, а причины у них разные и чинятся по-разному.
 *
 * `reason` — машинная и стабильная: по ней считают, а не читают.
 */
function denyGate(
  req: Request,
  res: Response,
  params: { status: number; reason: string; userId?: string | null; body: Record<string, unknown> },
) {
  logEvent(
    'gate.denied',
    {
      reason: params.reason,
      status: params.status,
      method: req.method,
      route: routeTemplate(req.path),
      userId: params.userId || undefined,
    },
    params.status >= 500 ? 'error' : 'warn',
    'gate',
    'Гейт подписки не пропустил изменяющий запрос',
  );
  return res.status(params.status).json(params.body);
}

export const requireActiveSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Гейт работает только для API
    if (!req.path.startsWith('/api/')) return next();

    // Чтение разрешено всегда — пользователь может сохранить/мигрировать свои данные
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) return next();

    // Публичные OAuth callback'и (security plan §N fix 2026-07-24) — провайдеры
    // (Google/VK/Instagram/FB/Threads/TikTok) редиректят без app Bearer-токена,
    // валидация делается через `state`-параметр на уровне handler'а.
    if ((req as any)._publicOauthBypass) return next();

    // Разрешённые префиксы (авторизация/оплата/продление)
    if (ALLOWED_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
      return next();
    }

    // Публичные вебхуки и коллбэки, которые физически доходят до этого гейта
    // (ЮКасса, коллбэки соответствия Meta и т.п.). Список общий с
    // `api-auth-gate.ts` намеренно: два независимых перечисления публичного
    // разойдутся, и разойдутся молча.
    if (isPublicApiPath(req.originalUrl || req.path, req.method)) return next();

    const token = extractToken(req);
    // Личность не предъявлена. Раньше это трактовалось как «наверное вебхук»
    // и пропускалось — теперь непроверяемая mutation не исполняется.
    if (!token) {
      return denyGate(req, res, {
        status: 401,
        reason: 'identity_missing',
        body: {
          error: 'Требуется авторизация',
          message: 'Для этого действия нужен действующий вход в аккаунт.',
          code: 'SUBSCRIPTION_IDENTITY_REQUIRED',
        },
      });
    }

    // Статический admin-токен — полный доступ
    if (process.env.DIRECTUS_STATIC_TOKEN && token === process.env.DIRECTUS_STATIC_TOKEN) {
      return next();
    }

    let status: StatusEntry;
    try {
      status = await fetchStatus(token);
    } catch (err) {
      const kind = err instanceof SubscriptionCheckError ? err.kind : 'unavailable';
      if (kind === 'invalid-session') {
        return denyGate(req, res, {
          status: 401,
          reason: 'session_invalid',
          body: {
            error: 'Сессия недействительна',
            message: 'Войдите в аккаунт заново.',
            code: 'SUBSCRIPTION_SESSION_INVALID',
          },
        });
      }
      return denyGate(req, res, {
        status: 503,
        reason: 'validation_unavailable',
        body: {
          error: 'Проверка подписки временно недоступна',
          message: 'Не удалось подтвердить статус подписки. Повторите попытку позже.',
          code: 'SUBSCRIPTION_VALIDATION_UNAVAILABLE',
        },
      });
    }

    if (status.isAdmin) return next();

    const expired = !!status.expireDate && new Date(status.expireDate) <= new Date();
    if (expired) {
      return denyGate(req, res, {
        status: 403,
        reason: 'subscription_expired',
        userId: status.userId,
        body: {
          error: 'Подписка истекла',
          message:
            'Доступ ограничен. Вы можете просмотреть и сохранить данные своих кампаний, но для продолжения работы выберите тариф.',
          subscriptionExpired: true,
        },
      });
    }

    return next();
  } catch {
    // Непредвиденный сбой самого гейта — тоже отказ, а не пропуск: иначе
    // достаточно уронить гейт, чтобы обойти проверку.
    if (res.headersSent) return;
    return denyGate(req, res, {
      status: 503,
      // Отдельная причина: снаружи ответ тот же, но здесь сломался сам гейт, а
      // не проверка подписки. Смешать их — значит потерять собственную аварию
      // среди чужих простоев.
      reason: 'gate_failure',
      body: {
        error: 'Проверка подписки временно недоступна',
        message: 'Не удалось подтвердить статус подписки. Повторите попытку позже.',
        code: 'SUBSCRIPTION_VALIDATION_UNAVAILABLE',
      },
    });
  }
};
