import { Request, Response, NextFunction } from 'express';
import { directusApi } from '../directus';

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
 *  - запросы без пользовательского токена (вебхуки провайдеров) — пропускаются,
 *    их аутентификация обрабатывается самими роутами;
 *  - администраторы — полный доступ;
 *  - при недоступности Directus гейт fail-open (не блокирует). Это осознанный
 *    компромисс: Directus — внешний VPS пользователя с известными простоями,
 *    и остальной код (ai.ts getUserPlanFromDirectus) тоже fail-open. Жёсткая
 *    блокировка при сбое Directus заблокировала бы платящих пользователей.
 *
 * Идентичность пользователя определяется через сам предъявленный токен
 * (GET /users/me с Bearer токеном) — Directus сам валидирует подпись/срок токена.
 * Мы НЕ доверяем расшифрованному payload JWT (его можно подделать).
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
  at: number;
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

async function fetchStatus(token: string): Promise<StatusEntry> {
  const cached = statusCache.get(token);
  if (cached && Date.now() - cached.at < STATUS_TTL) return cached;

  // Валидируем личность через сам токен — Directus отвергнет поддельный/просроченный
  const resp = await directusApi.get('/users/me', {
    headers: { Authorization: `Bearer ${token}` },
    params: { fields: 'expire_date,is_smm_admin,is_smm_super' },
  });

  const userData = resp.data?.data;
  const isAdmin = !!(userData?.is_smm_admin || userData?.is_smm_super);
  const expireDate = userData?.expire_date ?? null;

  const entry: StatusEntry = { expireDate, isAdmin, at: Date.now() };
  statusCache.set(token, entry);
  return entry;
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

    // Публичные OAuth callback'ов (security plan §N fix 2026-07-24) — провайдеры
    // (Google/VK/Instagram/FB/Threads/TikTok) редиректят без app Bearer-токена,
    // валидация делается через `state`-параметр на уровне handler'а.
    if ((req as any)._publicOauthBypass) return next();

    // Разрешённые префиксы (авторизация/оплата/продление)
    if (ALLOWED_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
      return next();
    }

    const token = extractToken(req);
    // Нет пользовательского токена — это вебхук/публичный роут, пропускаем
    if (!token) return next();

    // Статический admin-токен — полный доступ
    if (
      token === process.env.DIRECTUS_STATIC_TOKEN ||
      token === process.env.DIRECTUS_STATIC_TOKEN ||
      token === process.env.DIRECTUS_STATIC_TOKEN
    ) {
      return next();
    }

    const { expireDate, isAdmin } = await fetchStatus(token);
    if (isAdmin) return next();

    const expired = !!expireDate && new Date(expireDate) <= new Date();
    if (expired) {
      return res.status(403).json({
        error: 'Подписка истекла',
        message:
          'Доступ ограничен. Вы можете просмотреть и сохранить данные своих кампаний, но для продолжения работы выберите тариф.',
        subscriptionExpired: true,
      });
    }

    return next();
  } catch {
    // Fail-open: не блокируем при недоступности Directus (внешний VPS пользователя)
    return next();
  }
};
