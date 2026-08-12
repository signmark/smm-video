/**
 * Task #10: Behavioural — shared cache + user isolation + invalidation.
 *
 * Tests 1-3: isolated QueryClient via canonical queryOptions.
 * Test 4: real campaignStore.markCampaignAsDeleted (mocked queryClient).
 * Test 5: prefix invalidation matches scoped keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { campaignsListKey } from '@/hooks/use-campaigns';

let sharedQC: QueryClient;

vi.mock('@/lib/queryClient', () => ({
  get queryClient() { return sharedQC; },
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: { getState: () => ({ getAuthToken: () => 'test-token' }) },
}));

import { campaignsListQueryOptions } from '@/hooks/use-campaigns';
import { useCampaignStore } from '@/lib/campaignStore';

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sharedQC = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
});

function opts(userId: string) {
  return { ...campaignsListQueryOptions(userId), staleTime: 0, queryClient: sharedQC };
}

function waitFor(obs: QueryObserver<any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const unsub = obs.subscribe((r) => {
      if (r.isError) { unsub(); reject(r.error); }
      else if (r.isSuccess && r.data !== undefined) { unsub(); resolve(r.data); }
    });
  });
}

function mockFetch(resp: any) {
  let count = 0;
  const fn = vi.fn().mockImplementation(async () => {
    count++;
    return new Response(JSON.stringify(resp), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  (fn as any).count = () => count;
  return fn;
}

const origFetch = globalThis.fetch;

describe('task #10: shared cache', () => {
  afterEach(() => { globalThis.fetch = origFetch; });

  it('two observers same userId → 1 fetch', async () => {
    const fetch = mockFetch({ success: true, data: [{ id: '1' }] });
    globalThis.fetch = fetch as any;
    const o = opts('user-1');
    await Promise.all([waitFor(new QueryObserver(sharedQC, o)), waitFor(new QueryObserver(sharedQC, o))]);
    expect(fetch.count()).toBe(1);
  });

  it('different userIds → 2 fetches', async () => {
    const fetch = mockFetch({ success: true, data: [] });
    globalThis.fetch = fetch as any;
    await Promise.all([
      waitFor(new QueryObserver(sharedQC, opts('user-1'))),
      waitFor(new QueryObserver(sharedQC, opts('user-2'))),
    ]);
    expect(fetch.count()).toBe(2);
  });

  it('invalidateQueries → refetch via fetchQuery', async () => {
    const fetch = mockFetch({ success: true, data: [{ id: '1' }] });
    globalThis.fetch = fetch as any;
    await sharedQC.fetchQuery(opts('user-1'));
    expect(fetch.count()).toBe(1);
    sharedQC.invalidateQueries({ queryKey: campaignsListKey('user-1') });
    await sharedQC.fetchQuery(opts('user-1'));
    expect(fetch.count()).toBe(2);
  });

  it('campaignStore.markCampaignAsDeleted: scoped only, neighbour untouched, no unscoped key', async () => {
    const fetch = mockFetch({ success: true, data: [{ id: 'a' }, { id: 'b' }] });
    globalThis.fetch = fetch as any;

    // Prime both user caches
    await sharedQC.fetchQuery(opts('user-1'));
    await sharedQC.fetchQuery(opts('user-2'));

    // Production path: store calls localStorage.getItem('user_id')
    localStorage.setItem('user_id', 'user-1');
    useCampaignStore.getState().markCampaignAsDeleted('a');

    // user-1 cache: campaign 'a' removed
    const d1 = sharedQC.getQueryData(campaignsListKey('user-1')) as any;
    expect(d1.data).toHaveLength(1);
    expect(d1.data[0].id).toBe('b');

    // user-2 cache: untouched
    const d2 = sharedQC.getQueryData(campaignsListKey('user-2')) as any;
    expect(d2.data).toHaveLength(2);

    // Unscoped key absent (old bug: dual write)
    expect(sharedQC.getQueryData(['/api/campaigns'])).toBeUndefined();
  });

  it('prefix invalidation matches all scoped keys', async () => {
    const fetch = mockFetch({ success: true, data: [{ id: '1' }] });
    globalThis.fetch = fetch as any;
    await sharedQC.fetchQuery(opts('user-1'));
    await sharedQC.fetchQuery(opts('user-2'));

    sharedQC.invalidateQueries({ queryKey: ['/api/campaigns'] });
    expect(sharedQC.getQueryState(campaignsListKey('user-1'))?.isInvalidated).toBe(true);
    expect(sharedQC.getQueryState(campaignsListKey('user-2'))?.isInvalidated).toBe(true);
  });
});
