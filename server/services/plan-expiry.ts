import { directusApi } from '../directus';

/**
 * Сброс истёкшего тарифа на free — без крона, вызывается при входе пользователя.
 *
 * Принцип (согласовано с владельцем): админ вручную задаёт тариф и дату окончания;
 * по наступлении даты тариф автоматически меняется на самый дешёвый (free).
 * На админов (is_smm_admin / is_smm_super) правило НЕ распространяется.
 *
 * Физически переписываем plan в Directus (в дополнение к compute-on-read
 * getEffectivePlan), чтобы хранимое значение отражало реальность и админ-панель
 * показывала актуальный тариф. Идемпотентно и fail-open: любая ошибка Directus не
 * должна ломать логин.
 */
export async function downgradeExpiredPlan(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const adminToken =
      process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
    if (!adminToken) return;

    const resp = await directusApi.get(`/users/${userId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { fields: 'plan,expire_date,is_smm_admin,is_smm_super' },
    });
    const u = resp.data?.data;
    if (!u) return;

    // Админов не трогаем
    if (u.is_smm_admin || u.is_smm_super) return;

    const plan = u.plan;
    const expireDate = u.expire_date;
    if (!plan || plan === 'free' || !expireDate) return;

    const isExpired = new Date(expireDate).getTime() < Date.now();
    if (!isExpired) return;

    await directusApi.patch(
      `/users/${userId}`,
      { plan: 'free' },
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    console.log(`[plan-expiry] Тариф пользователя ${userId} сброшен на free (истёк ${expireDate}, был ${plan})`);
  } catch (err: any) {
    console.warn(`[plan-expiry] Не удалось проверить/сбросить тариф ${userId}:`, err?.message);
  }
}
