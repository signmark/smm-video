/**
 * SM-20, фаза 2 (B). Связка снятия публикаций с очереди с настоящими
 * хранилищами: реестр слотов, блокировки публикации и сами записи контента.
 *
 * Решение вынесено в отдельный модуль, а обращения к хранилищу — сюда, потому
 * что проверять здесь нечего, а проверять там нужно всё: правила «чужое не
 * трогаем», «ноль строк — не успех», «взятую публикацию не откатываем» живут в
 * решении и покрыты тестами без единого обращения к сети.
 */
import { directusApi } from '../directus';
import { log } from '../utils/logger';
import { autonomousCycleLedger } from './autonomous-cycle-ledger';
import { publicationLockManager } from './publication-lock-manager';
import type { DemotionDeps } from './autonomous-pause-content';

function ledgerAuthHeaders(): Record<string, string> {
  const token = process.env.DIRECTUS_STATIC_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Число строк, изменённых обновлением по запросу. */
function affectedCount(response: any): number {
  return Array.isArray(response?.data?.data) ? response.data.data.length : 0;
}

export function directusDemotionDeps(): DemotionDeps {
  return {
    listRunSlots: (runId) => autonomousCycleLedger.getRunItems(runId),

    async readContent(ids) {
      if (ids.length === 0) return [];
      const resp = await directusApi.get('/items/campaign_content', {
        params: {
          filter: { id: { _in: ids } },
          fields: ['id', 'status', 'social_platforms'],
          limit: ids.length,
        },
        headers: ledgerAuthHeaders(),
      });
      return (resp?.data?.data || []).map((row: any) => ({
        id: String(row.id),
        status: row.status ?? null,
        social_platforms: row.social_platforms,
      }));
    },

    /**
     * Блокировка берётся по каждой площадке записи — ровно так же и там же, где
     * её берёт планировщик публикаций. Если хоть одна площадка уже занята,
     * публикация считается идущей: снимать её нельзя, иначе мы откатим то, что
     * уже отправляется.
     *
     * Запись без площадок опубликовать нечем, поэтому блокировать нечего.
     */
    async acquireLocks(contentId, platforms) {
      if (platforms.length === 0) return true;
      const taken: string[] = [];
      for (const platform of platforms) {
        const ok = await publicationLockManager.acquireLock(contentId, platform);
        if (!ok) {
          for (const held of taken) await publicationLockManager.releaseLock(contentId, held);
          return false;
        }
        taken.push(platform);
      }
      return true;
    },

    async releaseLocks(contentId) {
      await publicationLockManager.releaseAllLocks(contentId);
    },

    /**
     * Условный перевод: в черновик уходит только то, что прямо сейчас стоит в
     * очереди. Число изменённых строк — единственный честный ответ на вопрос
     * «мы успели или нас опередили».
     */
    async demote(contentId) {
      const resp = await directusApi.patch(
        '/items/campaign_content',
        {
          query: { filter: { id: { _eq: contentId }, status: { _eq: 'scheduled' } } },
          data: { status: 'draft', scheduled_at: null },
        },
        { headers: ledgerAuthHeaders() },
      );
      const n = affectedCount(resp);
      log(`SM-20: снятие с очереди ${contentId} — изменено строк: ${n}`, 'autonomous', 'debug');
      return n;
    },

    consume: (slot) => autonomousCycleLedger.consumeByKey(slot.itemKey),
  };
}
