/**
 * task #84: единый источник профиля (AI-64 границу перенесли с «постоянно
 * устаревший кэш» на «единый источник + явный focus-refresh»).
 *
 * Раньше usePlan держал PROFILE_FRESHNESS = { staleTime:0, refetchOnMount:true }
 * и этим объявлял общий кэш профиля вечно протухшим — на холодной странице
 * профиль ехал дважды (fetch от Topbar/Content, затем refetch от usePlan).
 * Теперь политика одна (useUserProfile): staleTime 5 мин, refetchOnMount:false,
 * refetchOnWindowFocus:true — внешнее изменение тарифа ловится по фокусу окна
 * на ЛЮБОМ маршруте, без расщепления кэша.
 *
 * Эти тесты стерегут наблюдаемые гарантии, а не «значение константы».
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  profileQueryKey,
  PROFILE_STALE_TIME,
} from '../use-user-profile';

const SRC_USE_PLAN = readFileSync(path.resolve(__dirname, '../use-plan.ts'), 'utf8');

describe('task #84: единый источник профиля', () => {
  it('ключ профиля несёт дискриминатор userId', () => {
    expect(profileQueryKey('u1')).toEqual(['/api/user/profile', 'u1']);
    expect(profileQueryKey('u2')).toEqual(['/api/user/profile', 'u2']);
    expect(profileQueryKey('u1')).not.toEqual(profileQueryKey('u2'));
    expect(profileQueryKey(null)).toEqual(['/api/user/profile', 'me']);
  });

  it('staleTime положителен — кэш не объявляется вечно устаревшим', () => {
    expect(PROFILE_STALE_TIME).toBeGreaterThan(0);
    expect(PROFILE_STALE_TIME).toBe(5 * 60 * 1000);
  });

  it('usePlan читает профиль из useUserProfile, а не своим useQuery', () => {
    expect(SRC_USE_PLAN).toContain('useUserProfile()');
    expect(SRC_USE_PLAN).not.toContain('staleTime');
    expect(SRC_USE_PLAN).not.toContain('PROFILE_FRESHNESS');
  });
});
