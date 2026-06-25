import { directusApi } from '../lib/directus';

interface UsageEntry {
  count: number;
  month: string; // YYYY-MM
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getAdminToken(): string | undefined {
  return process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
}

/**
 * Читает JSON-поле image_gen_usage из записи пользователя Directus.
 * Поле хранит { month: "YYYY-MM", count: N }. Возвращает null, если поле пустое/некорректное.
 */
async function readEntry(userId: string): Promise<UsageEntry | null> {
  const resp = await directusApi.get(`/users/${userId}`, {
    headers: { Authorization: `Bearer ${getAdminToken()}` },
    params: { fields: 'image_gen_usage' },
  });
  const raw = resp.data?.data?.image_gen_usage;
  if (!raw) return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (parsed && typeof parsed.count === 'number' && typeof parsed.month === 'string') {
    return { count: parsed.count, month: parsed.month };
  }
  return null;
}

/**
 * Текущий расход генераций за этот месяц. При ошибке/новом месяце возвращает count: 0.
 */
export async function getUsage(userId: string): Promise<{ count: number; month: string }> {
  const currentMonth = getCurrentMonth();
  try {
    const entry = await readEntry(userId);
    if (!entry || entry.month !== currentMonth) {
      return { count: 0, month: currentMonth };
    }
    return { count: entry.count, month: currentMonth };
  } catch (e: any) {
    console.error('[image-gen-tracker] getUsage failed:', e?.message);
    return { count: 0, month: currentMonth };
  }
}

/**
 * Увеличивает счётчик на 1 (сбрасывая его при смене месяца) и сохраняет в Directus.
 * Возвращает новое значение; при ошибке возвращает 0, не прерывая генерацию.
 */
export async function incrementUsage(userId: string): Promise<number> {
  const currentMonth = getCurrentMonth();
  try {
    const entry = await readEntry(userId);
    const newCount = entry && entry.month === currentMonth ? entry.count + 1 : 1;
    await directusApi.patch(
      `/users/${userId}`,
      { image_gen_usage: { month: currentMonth, count: newCount } },
      { headers: { Authorization: `Bearer ${getAdminToken()}` } },
    );
    return newCount;
  } catch (e: any) {
    console.error('[image-gen-tracker] incrementUsage failed:', e?.message);
    return 0;
  }
}

/**
 * true, если пользователь ещё не исчерпал месячный лимит.
 */
export async function canGenerate(userId: string, limit: number): Promise<boolean> {
  const { count } = await getUsage(userId);
  return count < limit;
}
