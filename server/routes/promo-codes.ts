import { Router, Request, Response } from 'express';

const router = Router();

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
const ADMIN_TOKEN = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;

type PromoType = 'discount' | 'extra_days' | 'pro_upgrade';

async function checkAdminRights(token: string): Promise<boolean> {
  // Если передан сам admin-токен — сразу пропускаем
  if (token === process.env.DIRECTUS_STATIC_TOKEN || token === process.env.DIRECTUS_ADMIN_TOKEN || token === process.env.DIRECTUS_TOKEN) {
    return true;
  }
  try {
    const res = await fetch(`${DIRECTUS_URL}/users/me?fields=is_smm_admin`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      console.warn(`[promo-codes] checkAdminRights: /users/me returned ${res.status}`);
      return false;
    }
    const data = await res.json();
    return !!data.data?.is_smm_admin;
  } catch (e) {
    console.error('[promo-codes] checkAdminRights error:', e);
    return false;
  }
}

function getUserToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}

async function ensureCollectionsExist() {
  if (!ADMIN_TOKEN) return;

  const headers = {
    'Authorization': `Bearer ${ADMIN_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const promoCodesFields = [
    { field: 'code', type: 'string', meta: { required: true }, schema: { is_unique: true, is_nullable: false } },
    { field: 'type', type: 'string', meta: { required: true }, schema: { is_nullable: false } },
    { field: 'value', type: 'integer', meta: { required: true }, schema: { is_nullable: false } },
    { field: 'description', type: 'text', schema: { is_nullable: true } },
    { field: 'max_uses', type: 'integer', schema: { is_nullable: true } },
    { field: 'used_count', type: 'integer', schema: { default_value: 0, is_nullable: false } },
    { field: 'is_active', type: 'boolean', schema: { default_value: true, is_nullable: false } },
    { field: 'expires_at', type: 'timestamp', schema: { is_nullable: true } },
    { field: 'date_created', type: 'timestamp', schema: { is_nullable: true } },
  ];

  const promoUsesFields = [
    { field: 'promo_code_id', type: 'string', schema: { is_nullable: false } },
    { field: 'user_id', type: 'string', schema: { is_nullable: false } },
    { field: 'used_at', type: 'timestamp', schema: { is_nullable: false } },
    { field: 'payment_id', type: 'string', schema: { is_nullable: true } },
    { field: 'plan_before', type: 'string', schema: { is_nullable: true } },
    { field: 'expire_before', type: 'timestamp', schema: { is_nullable: true } },
  ];

  for (const collectionDef of [
    { name: 'promo_codes', fields: promoCodesFields },
    { name: 'promo_code_uses', fields: promoUsesFields },
  ]) {
    try {
      const check = await fetch(`${DIRECTUS_URL}/collections/${collectionDef.name}`, { headers });
      if (check.status === 200) continue;

      await fetch(`${DIRECTUS_URL}/collections`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ collection: collectionDef.name, fields: collectionDef.fields })
      });
      console.log(`[promo-codes] Created collection: ${collectionDef.name}`);
    } catch (err) {
      console.error(`[promo-codes] Error ensuring collection ${collectionDef.name}:`, err);
    }
  }
}

ensureCollectionsExist();

router.get('/admin/promo-codes', async (req: Request, res: Response) => {
  const token = getUserToken(req);
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  const isAdmin = await checkAdminRights(token);
  if (!isAdmin) return res.status(403).json({ error: 'Нет прав доступа' });

  try {
    const getUrl = `${DIRECTUS_URL}/items/promo_codes?limit=200`;
    const response = await fetch(getUrl,
      { headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` } }
    );
    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.errors?.[0]?.message || 'Ошибка получения промокодов из Directus';
      console.error('[promo-codes] Directus GET error:', data.errors);
      return res.status(502).json({ error: errMsg });
    }

    const codes = (data.data || []).map((code: any) => ({
      ...code,
      uses: code.used_count || 0,
    }));

    return res.json({ success: true, data: codes });
  } catch (err: any) {
    console.error('[promo-codes] GET error:', err);
    return res.status(500).json({ error: 'Ошибка получения промокодов' });
  }
});

router.post('/admin/promo-codes', async (req: Request, res: Response) => {
  const token = getUserToken(req);
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  const isAdmin = await checkAdminRights(token);
  if (!isAdmin) return res.status(403).json({ error: 'Нет прав доступа' });

  const { code, type, value, description, max_uses, is_active, expires_at } = req.body;

  if (!code || !type || value === undefined) {
    return res.status(400).json({ error: 'Обязательные поля: code, type, value' });
  }

  if (!['discount', 'extra_days', 'pro_upgrade'].includes(type)) {
    return res.status(400).json({ error: 'Недопустимый тип промокода' });
  }

  if (type === 'discount' && (value < 1 || value > 100)) {
    return res.status(400).json({ error: 'Скидка должна быть от 1 до 100%' });
  }

  try {
    const response = await fetch(`${DIRECTUS_URL}/items/promo_codes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: code.toUpperCase().trim(),
        type,
        value: Number(value),
        description: description || null,
        max_uses: max_uses ? Number(max_uses) : null,
        used_count: 0,
        is_active: is_active !== false,
        expires_at: expires_at || null,
      })
    });

    const result = await response.json();

    if (!response.ok) {
      const errMsg = result.errors?.[0]?.message || 'Ошибка создания промокода';
      console.error('[promo-codes] POST error:', errMsg);
      return res.status(400).json({ error: errMsg });
    }

    return res.json({ success: true, data: result.data });
  } catch (err: any) {
    console.error('[promo-codes] POST error:', err);
    return res.status(500).json({ error: 'Ошибка создания промокода' });
  }
});

router.patch('/admin/promo-codes/:id', async (req: Request, res: Response) => {
  const token = getUserToken(req);
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  const isAdmin = await checkAdminRights(token);
  if (!isAdmin) return res.status(403).json({ error: 'Нет прав доступа' });

  const { id } = req.params;
  const updates = req.body;

  try {
    const response = await fetch(`${DIRECTUS_URL}/items/promo_codes/${id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    const result = await response.json();
    if (!response.ok) {
      return res.status(400).json({ error: result.errors?.[0]?.message || 'Ошибка обновления' });
    }

    return res.json({ success: true, data: result.data });
  } catch (err: any) {
    console.error('[promo-codes] PATCH error:', err);
    return res.status(500).json({ error: 'Ошибка обновления промокода' });
  }
});

router.delete('/admin/promo-codes/:id', async (req: Request, res: Response) => {
  const token = getUserToken(req);
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  const isAdmin = await checkAdminRights(token);
  if (!isAdmin) return res.status(403).json({ error: 'Нет прав доступа' });

  const { id } = req.params;

  try {
    await fetch(`${DIRECTUS_URL}/items/promo_codes/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
    });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[promo-codes] DELETE error:', err);
    return res.status(500).json({ error: 'Ошибка удаления промокода' });
  }
});

router.get('/admin/promo-codes/:id/uses', async (req: Request, res: Response) => {
  const token = getUserToken(req);
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  const isAdmin = await checkAdminRights(token);
  if (!isAdmin) return res.status(403).json({ error: 'Нет прав доступа' });

  const { id } = req.params;

  try {
    const response = await fetch(
      `${DIRECTUS_URL}/items/promo_code_uses?filter[promo_code_id][_eq]=${id}&sort=-used_at&limit=100`,
      { headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` } }
    );
    const data = await response.json();
    return res.json({ success: true, data: data.data || [] });
  } catch (err: any) {
    console.error('[promo-codes] GET uses error:', err);
    return res.status(500).json({ error: 'Ошибка получения использований' });
  }
});

router.post('/promo/validate', async (req: Request, res: Response) => {
  const token = getUserToken(req);
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Укажите код' });

  try {
    const meRes = await fetch(`${DIRECTUS_URL}/users/me?fields=id`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!meRes.ok) return res.status(401).json({ error: 'Требуется авторизация' });
    const meData = await meRes.json();
    const userId = meData.data?.id;

    const codeRes = await fetch(
      `${DIRECTUS_URL}/items/promo_codes?filter[code][_eq]=${encodeURIComponent(code.toUpperCase().trim())}&limit=1`,
      { headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` } }
    );
    const codeData = await codeRes.json();
    const promo = codeData.data?.[0];

    if (!promo) return res.status(404).json({ valid: false, error: 'Промокод не найден' });
    if (!promo.is_active) return res.status(400).json({ valid: false, error: 'Промокод деактивирован' });
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      return res.status(400).json({ valid: false, error: 'Срок действия промокода истёк' });
    }
    if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
      return res.status(400).json({ valid: false, error: 'Промокод исчерпал лимит использований' });
    }

    const usesRes = await fetch(
      `${DIRECTUS_URL}/items/promo_code_uses?filter[promo_code_id][_eq]=${promo.id}&filter[user_id][_eq]=${userId}&limit=1`,
      { headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` } }
    );
    const usesData = await usesRes.json();
    if (usesData.data?.length > 0) {
      return res.status(400).json({ valid: false, error: 'Вы уже использовали этот промокод' });
    }

    return res.json({
      valid: true,
      promo: {
        id: promo.id,
        code: promo.code,
        type: promo.type as PromoType,
        value: promo.value,
        description: promo.description,
      }
    });
  } catch (err: any) {
    console.error('[promo-codes] validate error:', err);
    return res.status(500).json({ error: 'Ошибка проверки промокода' });
  }
});

router.post('/promo/redeem', async (req: Request, res: Response) => {
  const token = getUserToken(req);
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Укажите код' });

  try {
    const meRes = await fetch(`${DIRECTUS_URL}/users/me?fields=id`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!meRes.ok) return res.status(401).json({ error: 'Требуется авторизация' });
    const meData = await meRes.json();
    const userId = meData.data?.id;

    const codeRes = await fetch(
      `${DIRECTUS_URL}/items/promo_codes?filter[code][_eq]=${encodeURIComponent(code.toUpperCase().trim())}&limit=1`,
      { headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` } }
    );
    const codeData = await codeRes.json();
    const promo = codeData.data?.[0];

    if (!promo) return res.status(404).json({ success: false, error: 'Промокод не найден' });
    if (!promo.is_active) return res.status(400).json({ success: false, error: 'Промокод деактивирован' });
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: 'Срок действия промокода истёк' });
    }
    if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
      return res.status(400).json({ success: false, error: 'Промокод исчерпал лимит использований' });
    }

    const usesRes = await fetch(
      `${DIRECTUS_URL}/items/promo_code_uses?filter[promo_code_id][_eq]=${promo.id}&filter[user_id][_eq]=${userId}&limit=1`,
      { headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` } }
    );
    const usesData = await usesRes.json();
    if (usesData.data?.length > 0) {
      return res.status(400).json({ success: false, error: 'Вы уже использовали этот промокод' });
    }

    if (promo.type === 'discount') {
      return res.status(400).json({ success: false, error: 'Скидочные коды применяются при оплате' });
    }

    const userRes = await fetch(`${DIRECTUS_URL}/users/${userId}?fields=plan,expire_date`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
    });
    const userData = await userRes.json();
    const user = userData.data;
    const planBefore = user.plan;
    const expireBefore = user.expire_date;

    const now = new Date();
    const currentExpire = expireBefore ? new Date(expireBefore) : now;
    const baseDate = currentExpire > now ? currentExpire : now;

    let newExpire: Date;
    let newPlan: string | undefined;

    if (promo.type === 'extra_days') {
      newExpire = new Date(baseDate.getTime() + promo.value * 24 * 60 * 60 * 1000);
    } else if (promo.type === 'pro_upgrade') {
      newExpire = new Date(baseDate.getTime() + promo.value * 24 * 60 * 60 * 1000);
      newPlan = 'pro';
    } else {
      return res.status(400).json({ success: false, error: 'Неизвестный тип промокода' });
    }

    const userUpdates: Record<string, any> = { expire_date: newExpire.toISOString() };
    if (newPlan) userUpdates.plan = newPlan;

    await fetch(`${DIRECTUS_URL}/users/${userId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(userUpdates)
    });

    await fetch(`${DIRECTUS_URL}/items/promo_code_uses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        promo_code_id: promo.id,
        user_id: userId,
        used_at: now.toISOString(),
        plan_before: planBefore,
        expire_before: expireBefore,
      })
    });

    await fetch(`${DIRECTUS_URL}/items/promo_codes/${promo.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ used_count: (promo.used_count || 0) + 1 })
    });

    return res.json({
      success: true,
      type: promo.type,
      newExpireDate: newExpire.toISOString(),
      newPlan: newPlan || planBefore,
      message: promo.type === 'extra_days'
        ? `Добавлено ${promo.value} дней к подписке`
        : `Активирован Pro-доступ на ${promo.value} дней`,
    });
  } catch (err: any) {
    console.error('[promo-codes] redeem error:', err);
    return res.status(500).json({ success: false, error: 'Ошибка применения промокода' });
  }
});

export default router;
