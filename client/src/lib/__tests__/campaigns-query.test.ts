/**
 * Регрессионные проверки для хелпера campaigns-query.
 *
 * Цель — поймать разъезд consumers по queryKey/опциям до того, как он
 * превратится в дублирующиеся загрузки или в утечку данных между
 * аккаунтами.
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  campaignsInvalidationKey,
  campaignsListQueryOptions,
  campaignsQueryKey,
} from '../campaigns-query';

describe('campaignsQueryKey', () => {
  it('возвращает user-scoped exact key для известного userId', () => {
    const key = campaignsQueryKey('user-1');
    expect(Array.isArray(key)).toBe(true);
    expect([...key]).toEqual(['/api/campaigns', 'user-1']);
  });

  it('возвращает единый «анонимный» ключ, чтобы не плодить разные ключи', () => {
    const a = campaignsQueryKey(null);
    const b = campaignsQueryKey(undefined);
    expect([...a]).toEqual(['/api/campaigns']);
    expect([...b]).toEqual(['/api/campaigns']);
    // По содержанию массивы должны совпасть — это требование exact match
    expect(a.length).toBe(b.length);
    expect(a[0]).toBe(b[0]);
  });

  it('заморожен — consumers не должны мутировать', () => {
    const key = campaignsQueryKey('user-1');
    expect(Object.isFrozen(key)).toBe(true);
  });

  it('возвращает разные ключи для разных userId (изоляция аккаунтов)', () => {
    const a = campaignsQueryKey('user-1');
    const b = campaignsQueryKey('user-2');
    expect(a[1]).toBe('user-1');
    expect(b[1]).toBe('user-2');
    expect(a[1]).not.toBe(b[1]);
  });
});

describe('campaignsListQueryOptions', () => {
  it('включает enabled только при наличии userId', () => {
    const opts = campaignsListQueryOptions({
      userId: null,
      queryFn: () => Promise.resolve({ data: [] }),
    });
    expect(opts.enabled).toBe(false);

    const optsUser = campaignsListQueryOptions({
      userId: 'user-1',
      queryFn: () => Promise.resolve({ data: [] }),
    });
    expect(optsUser.enabled).toBe(true);
  });

  it('задаёт staleTime: 60_000 и НЕ задаёт refetchInterval', () => {
    const opts = campaignsListQueryOptions({
      userId: 'user-1',
      queryFn: () => Promise.resolve({ data: [] }),
    });
    expect(opts.staleTime).toBe(60_000);
    // Полить сознательно не задан — должен отсутствовать в опциях
    expect(opts.refetchInterval).toBeUndefined();
    expect(opts.refetchIntervalInBackground).toBeUndefined();
  });

  it('queryFn передаётся без обёрток', () => {
    const fn = () => Promise.resolve({ data: [] });
    const opts = campaignsListQueryOptions({ userId: 'user-1', queryFn: fn });
    expect(opts.queryFn).toBe(fn);
  });

  it('queryKey совпадает с campaignsQueryKey(userId)', () => {
    const opts = campaignsListQueryOptions({
      userId: 'user-1',
      queryFn: () => Promise.resolve({ data: [] }),
    });
    const expected = campaignsQueryKey('user-1');
    expect(opts.queryKey).toEqual(expected);
  });
});

describe('integration: два consumers делят кэш', () => {
  let queryClient: QueryClient;
  let queryFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryFn = vi.fn(async () => ({ data: [{ id: 'c1', name: 'Camp 1' }] }));
  });

  it('при двух подписках с одним ключом — fetch вызывается один раз', async () => {
    const opts1 = campaignsListQueryOptions({ userId: 'user-1', queryFn });
    const opts2 = campaignsListQueryOptions({ userId: 'user-1', queryFn });

    // Один и тот же queryKey — две подписки используют один Query.
    expect(opts1.queryKey).toEqual(opts2.queryKey);

    // Симулируем первый fetch через queryFn.
    await queryClient.fetchQuery(opts1);
    await queryClient.fetchQuery(opts2);

    // queryFn должен быть вызван ровно один раз — обе подписки используют
    // общий кэш благодаря exact key match.
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('инвалидация по userId сбрасывает только этого пользователя', async () => {
    const optsUser1 = campaignsListQueryOptions({
      userId: 'user-1',
      queryFn: vi.fn(async () => ({ data: [] })),
    });
    const optsUser2 = campaignsListQueryOptions({
      userId: 'user-2',
      queryFn: vi.fn(async () => ({ data: [] })),
    });

    await queryClient.fetchQuery(optsUser1);
    await queryClient.fetchQuery(optsUser2);

    queryClient.invalidateQueries({ queryKey: campaignsInvalidationKey('user-1') });

    // User-1 ключ инвалидирован, user-2 — нет.
    const state1 = queryClient.getQueryState(campaignsQueryKey('user-1'));
    const state2 = queryClient.getQueryState(campaignsQueryKey('user-2'));
    expect(state1?.isInvalidated).toBe(true);
    expect(state2?.isInvalidated).toBe(false);
  });
});