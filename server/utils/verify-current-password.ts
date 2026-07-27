import { directusApiManager } from '../directus';

/**
 * Проверка текущего пароля пользователя.
 *
 * Способ выбран не новый: это ровно тот же вызов Directus, которым живёт
 * POST /api/auth/login (server/api/auth-routes.ts:295) — `/auth/login` с
 * email и паролем через directusApiManager. Собственной проверки хэша у нас
 * нет и быть не должно, а этот путь ежедневно подтверждается живым продом:
 * если бы Directus его не принимал, в приложение никто бы не входил.
 *
 * `mode: 'json'` — как в логине: refresh-кука в ответ не ставится, выданный
 * токен мы просто выбрасываем.
 *
 * Fail-closed: «неверный пароль» возвращается ТОЛЬКО на явный отказ Directus
 * (401/403 — неверные учётные данные). Недоступность Directus, таймаут,
 * 5xx — это исключение наверх, чтобы обработчик ответил 500. Молчаливое
 * `false` при недоступности заблокировало бы легальную смену пароля, а
 * молчаливое `true` — открыло бы дыру, которую мы здесь и закрываем.
 */
export async function verifyCurrentPassword(email: string, password: string): Promise<boolean> {
  try {
    await directusApiManager.post('/auth/login', {
      email,
      password,
      mode: 'json',
    });
    return true;
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 401 || status === 403) return false;
    throw err;
  }
}
