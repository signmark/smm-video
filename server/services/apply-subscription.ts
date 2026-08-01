/**
 * Применение одобренной подписки с проверкой записи (AI-64).
 *
 * Инцидент 01.08.2026: владелец одобрил тариф в Telegram, бот ответил
 * «✅ Подписка активирована», а в базе осталось прежнее значение — пользователь
 * так и остался без тарифа. Разбор показал, что обработчик считал успехом сам
 * факт `response.ok` от Directus и на этом останавливался.
 *
 * Проверять код ответа недостаточно: 200 означает «запрос принят», а не «поле
 * сохранено». Directus может вернуть 200 и не применить часть полей — например,
 * если политика токена их не пишет. Ровно этот класс уже стоил нам утреннего
 * инцидента на чтении (гейт подписки), теперь тот же класс всплыл на записи.
 *
 * Поэтому здесь: записали → прочитали обратно → сверили. Владельцу сообщается
 * успех только если прочитанное совпало с запрошенным.
 */

export interface ApplySubscriptionParams {
  directusUrl: string;
  adminToken: string;
  userId: string;
  /** Значение поля `plan`, которое должно оказаться в базе. */
  planValue: string;
  /** Дата в формате YYYY-MM-DD. */
  expireDateStr: string;
  fetchImpl?: typeof fetch;
}

export type ApplySubscriptionResult =
  | { ok: true; readback: { plan: string; expire_date: string } }
  /** Directus отказал на записи. */
  | { ok: false; reason: 'write-failed'; status: number; body: string }
  /** Записали, но прочитать не смогли — подтвердить нечем. */
  | { ok: false; reason: 'readback-failed'; status: number }
  /** Записали, ответ 200, но в базе не то. Самый опасный случай: он и молчал. */
  | { ok: false; reason: 'not-applied'; expected: { plan: string; expire_date: string }; actual: { plan: unknown; expire_date: unknown } };

/** Directus отдаёт дату как `2026-08-31` или `2026-08-31T00:00:00`. Сравниваем день. */
function sameDay(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.slice(0, 10) === b.slice(0, 10);
}

export async function applySubscription(
  params: ApplySubscriptionParams,
): Promise<ApplySubscriptionResult> {
  const { directusUrl, adminToken, userId, planValue, expireDateStr } = params;
  const doFetch = params.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  const writeResp = await doFetch(`${directusUrl}/users/${userId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ expire_date: expireDateStr, plan: planValue }),
  });

  if (!writeResp.ok) {
    return {
      ok: false,
      reason: 'write-failed',
      status: writeResp.status,
      body: (await writeResp.text()).slice(0, 200),
    };
  }

  // Читаем обратно тем же токеном. Без этого шага «200» выдаётся за «сохранено».
  const readResp = await doFetch(
    `${directusUrl}/users/${userId}?fields=plan,expire_date`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );

  if (!readResp.ok) {
    return { ok: false, reason: 'readback-failed', status: readResp.status };
  }

  const data = (await readResp.json())?.data ?? {};

  if (data.plan !== planValue || !sameDay(data.expire_date, expireDateStr)) {
    return {
      ok: false,
      reason: 'not-applied',
      expected: { plan: planValue, expire_date: expireDateStr },
      actual: { plan: data.plan, expire_date: data.expire_date },
    };
  }

  return { ok: true, readback: { plan: data.plan, expire_date: data.expire_date } };
}
