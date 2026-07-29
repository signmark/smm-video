/**
 * Токен Directus для операций публикации.
 *
 * Правило: **публикация ходит сервисным токеном, не пользовательским.**
 * Сервисный токен на то и заведён — одним админским доступом читать кампании
 * ВСЕХ пользователей, чтобы фоновая публикация работала независимо от того, есть
 * ли живая сессия у владельца кампании. Пользовательский токен — для операций из
 * морды, где действует именно пользователь.
 *
 * Почему это выделено в отдельный модуль: раньше каждая платформа собирала
 * лесенку токенов сама, и они разошлись. Threads/FB/TG/VK/IG сначала брали токен
 * пользователя и только потом сервисный, а stories/clips/reels/YouTube — сразу
 * сервисный. Пользовательский токен валиден, но прав на чужую кампанию не имеет,
 * и Directus отвечает 403 — не 401. Ретраи ловили только 401, поэтому публикация
 * падала с «Ошибка загрузки кампании …: HTTP 403» при живом рабочем доступе.
 */

/** Порядок совпадает с directus-crud.ts, чтобы окружения не расходились. */
export function getServiceTokenFromEnv(): string | null {
  return (
    process.env.DIRECTUS_STATIC_TOKEN ||
    null
  );
}

/**
 * Сервисный токен для публикации. Никогда не возвращает токен пользователя.
 * Если в окружении токена нет — последняя попытка через админский вход.
 */
export async function resolvePublishingToken(): Promise<string | null> {
  const fromEnv = getServiceTokenFromEnv();
  if (fromEnv) return fromEnv;

  try {
    const { directusAuthManager } = await import('./directus-auth-manager');
    const adminToken = await directusAuthManager.getAdminAuthToken();
    if (adminToken) return adminToken;
  } catch {
    // Падать здесь нельзя: у вызывающего своя обработка отсутствия токена.
  }

  // Последний рубеж — админский вход по логину/паролю. Раньше он был только у
  // Threads; теперь доступен всем платформам, чтобы поведение не расходилось.
  const directusUrl = process.env.DIRECTUS_URL;
  const email = process.env.DIRECTUS_ADMIN_EMAIL;
  const password = process.env.DIRECTUS_ADMIN_PASSWORD;
  if (directusUrl && email && password) {
    try {
      const { default: axios } = await import('axios');
      const loginResp = await axios.post(`${directusUrl}/auth/login`, { email, password });
      return loginResp.data?.data?.access_token || null;
    } catch {
      // см. выше
    }
  }

  return null;
}
