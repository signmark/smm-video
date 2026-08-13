/**
 * task #81: сценарные регрессии (критерии 4 и 5 из handoff #80).
 *
 * Критерий 5 — изоляция аккаунтов на двух уровнях:
 *   - внутри сессии: key-фабрики списка/детали кампании и профиля несут
 *     userId/campaignId, поэтому кэш двух tenant не склеивается;
 *   - между сессиями: смена учётной записи фиксируется `isSameSession` (по
 *     userId + sessionId) и приводит к `queryClient.clear()` — старый кэш
 *     не переживает вход другого аккаунта.
 *
 * Критерий 4 — свежесть после мутации: правка B сняла route-entry форс;
 * свежесть держится на scoped invalidateQueries, который каждая мутация уже
 * вызывает. Доказываем, что scoped invalidation помечает устаревшим только
 * целевую кампанию и что реальный хелпер `updateContentCachesAfterMoveToDraft`
 * пишет по тому же scoped ключу.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { campaignsListKey, campaignDetailKey } from '@/hooks/use-campaigns';
import { updateContentCachesAfterMoveToDraft } from '@/lib/content-cache-updates';
import { getSessionSnapshot, isSameSession, rotateSessionId } from '@/lib/sessionCoordinator';

const SESSION_ID_KEY = 'auth_session_id';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('task #81: изоляция кэша по tenant внутри сессии (критерий 5)', () => {
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

  it('на разных ключах QueryClient хранит разные записи без затирания', () => {
    const qc = new QueryClient();
    qc.setQueryData(campaignsListKey('user-1'), { data: [{ id: 'a-of-u1' }] });
    qc.setQueryData(campaignsListKey('user-2'), { data: [{ id: 'a-of-u2' }] });

    expect(qc.getQueryData(campaignsListKey('user-1'))).toEqual({ data: [{ id: 'a-of-u1' }] });
    expect(qc.getQueryData(campaignsListKey('user-2'))).toEqual({ data: [{ id: 'a-of-u2' }] });
    expect(qc.getQueryData(campaignsListKey('user-1'))).toEqual({ data: [{ id: 'a-of-u1' }] });
  });
});

describe('task #81: изоляция при смене аккаунта (критерий 5)', () => {
  it('isSameSession различает аккаунты по userId', () => {
    localStorage.setItem('auth_token', 't1');
    localStorage.setItem('user_id', 'user-1');
    const sessionId = rotateSessionId();

    const snap = getSessionSnapshot();
    expect(isSameSession(snap)).toBe(true);

    // Смена userId при том же token/sessionId — это другой аккаунт.
    localStorage.setItem('user_id', 'user-2');
    expect(isSameSession(snap)).toBe(false);
  });

  it('queryClient.clear() стирает кэш предыдущего аккаунта (граница forceLogout)', () => {
    // forceLogout() в queryClient.ts делает ровно это: queryClient.clear() после
    // logout. Проверяем сам факт, что clear убирает кэш старого tenant.
    const qc = new QueryClient();
    qc.setQueryData(campaignsListKey('user-1'), { data: [{ id: 'stale' }] });

    // Граница смены сессии.
    qc.clear();

    expect(qc.getQueryData(campaignsListKey('user-1'))).toBeUndefined();
  });
});

describe('task #81: свежесть после мутации (критерий 4)', () => {
  it('scoped invalidateQueries помечает устаревшим только целевую кампанию', () => {
    const qc = new QueryClient();
    qc.setQueryData(['/api/campaign-content', 'camp-a'], [{ id: 'a' }]);
    qc.setQueryData(['/api/campaign-content', 'camp-b'], [{ id: 'b' }]);

    qc.invalidateQueries({ queryKey: ['/api/campaign-content', 'camp-a'] });

    expect(qc.getQueryState(['/api/campaign-content', 'camp-a'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['/api/campaign-content', 'camp-b'])?.isInvalidated).toBeFalsy();
  });

  it('реальный хелпер moveToDraft пишет по тому же scoped ключу', () => {
    const qc = new QueryClient();
    qc.setQueryData(['/api/campaign-content', 'camp-a'], [
      { id: '1', status: 'scheduled', scheduledAt: 'x', socialPlatforms: { tg: { status: 'pending' } } },
    ]);

    updateContentCachesAfterMoveToDraft(qc, 'camp-a', '1');

    const list = qc.getQueryData(['/api/campaign-content', 'camp-a']) as any[];
    expect(list[0].status).toBe('draft');
  });
});
