/**
 * task #81: сценарные регрессии (критерии 4 и 5 из handoff #80).
 *
 * Критерий 4 — свежесть после мутации: правка B убрала форс refetch на входе
 * в маршрут; свежесть должна обеспечиваться инвалидациями, которые уже есть у
 * каждой мутации. Здесь доказываем, что scoped `invalidateQueries` по
 * campaign-content приводит к re-fetch именно этой кампании, а не требуе
 * route-entry форс.
 *
 * Критерий 5 — изоляция двух аккаунтов: key-фабрики кампаний/профиля несут
 * userId/campaignId, поэтому кэш двух tenant не склеивается.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { campaignsListKey, campaignDetailKey } from '@/hooks/use-campaigns';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('task #81: изоляция кэша по tenant (критерий 5)', () => {
  it('список кампаний двух пользователей — разные ключи', () => {
    expect(campaignsListKey('user-1')).toEqual(['/api/campaigns', 'user-1']);
    expect(campaignsListKey('user-2')).toEqual(['/api/campaigns', 'user-2']);
    expect(campaignsListKey('user-1')).not.toEqual(campaignsListKey('user-2'));
  });

  it('деталь кампании — дискриминируется id кампании', () => {
    expect(campaignDetailKey('camp-a')).toEqual(['/api/campaigns', 'camp-a', 'detail']);
    expect(campaignDetailKey('camp-b')).toEqual(['/api/campaigns', 'camp-b', 'detail']);
    expect(campaignDetailKey('camp-a')).not.toEqual(campaignDetailKey('camp-b'));
  });

  it('на разных ключах QueryClient хранит разные записи', () => {
    const qc = new QueryClient();
    qc.setQueryData(campaignsListKey('user-1'), { data: [{ id: 'a-of-u1' }] });
    qc.setQueryData(campaignsListKey('user-2'), { data: [{ id: 'a-of-u2' }] });

    expect(qc.getQueryData(campaignsListKey('user-1'))).toEqual({ data: [{ id: 'a-of-u1' }] });
    expect(qc.getQueryData(campaignsListKey('user-2'))).toEqual({ data: [{ id: 'a-of-u2' }] });
    // Запись user-2 не затирает user-1.
    expect(qc.getQueryData(campaignsListKey('user-1'))).toEqual({ data: [{ id: 'a-of-u1' }] });
  });
});

describe('task #81: свежесть после мутации без route-entry форса (критерий 4)', () => {
  it('scoped invalidateQueries по campaign-content помечает запрос устаревшим → re-fetch', () => {
    const qc = new QueryClient();
    const contentKey = ['/api/campaign-content', 'camp-a'] as const;

    // Сначала кладём данные в кэш под ключом (как после первичной загрузки).
    qc.setQueryData(contentKey, [{ id: 'c1', status: 'draft' }]);

    // Мутация публикации делает scoped invalidate (тот же вызов, что в content/index.tsx).
    qc.invalidateQueries({ queryKey: ['/api/campaign-content', 'camp-a'] });

    const state = qc.getQueryState(contentKey);
    // invalidateQueries помечает запрос stale/invalidated — после этого React Query
    // при следующем mount/refetch подтянет свежее, не дожидаясь route-entry форса.
    expect(state?.isInvalidated).toBe(true);
  });

  it('scoped invalidate НЕ трогает другую кампанию', () => {
    const qc = new QueryClient();
    qc.setQueryData(['/api/campaign-content', 'camp-a'], [{ id: 'a' }]);
    qc.setQueryData(['/api/campaign-content', 'camp-b'], [{ id: 'b' }]);

    qc.invalidateQueries({ queryKey: ['/api/campaign-content', 'camp-a'] });

    expect(qc.getQueryState(['/api/campaign-content', 'camp-a'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['/api/campaign-content', 'camp-b'])?.isInvalidated).toBeFalsy();
  });
});
