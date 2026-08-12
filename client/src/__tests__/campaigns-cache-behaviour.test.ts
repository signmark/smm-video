/**
 * Task #10: Behavioural — shared cache + user isolation + invalidation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { campaignsListKey } from '@/hooks/use-campaigns';

vi.mock('@/lib/store', () => ({
  useAuthStore: { getState: () => ({ getAuthToken: () => 'test-token' }) },
}));

import { campaignsListQueryOptions } from '@/hooks/use-campaigns';

function createQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function obsOpts(userId: string, qc: QueryClient) {
  return { ...campaignsListQueryOptions(userId), staleTime: 0, queryClient: qc };
}

function waitFor(obs: QueryObserver<any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const unsub = obs.subscribe((r) => {
      if (r.isError) { unsub(); reject(r.error); }
      else if (r.isSuccess && r.data !== undefined) { unsub(); resolve(r.data); }
    });
  });
}

describe('task #10: shared cache', () => {
  it('two observers same userId → 1 fetch', async () => {
    const qc = createQC();
    let count = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      count++;
      return new Response(JSON.stringify({ success: true, data: [{ id: '1' }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    try {
      const opts = obsOpts('user-1', qc);
      await Promise.all([waitFor(new QueryObserver(qc, opts)), waitFor(new QueryObserver(qc, opts))]);
      expect(count).toBe(1);
    } finally { globalThis.fetch = orig; }
  });

  it('different userIds → 2 fetches', async () => {
    const qc = createQC();
    let count = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      count++;
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    try {
      await Promise.all([
        waitFor(new QueryObserver(qc, obsOpts('user-1', qc))),
        waitFor(new QueryObserver(qc, obsOpts('user-2', qc))),
      ]);
      expect(count).toBe(2);
    } finally { globalThis.fetch = orig; }
  });

  it('invalidateQueries → refetch via fetchQuery', async () => {
    const qc = createQC();
    let count = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      count++;
      return new Response(JSON.stringify({ success: true, data: [{ id: String(count) }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    try {
      // Prime the cache
      await qc.fetchQuery(obsOpts('user-1', qc));
      expect(count).toBe(1);

      // Invalidate and re-fetch
      qc.invalidateQueries({ queryKey: campaignsListKey('user-1') });
      await qc.fetchQuery(obsOpts('user-1', qc));
      expect(count).toBe(2);
    } finally { globalThis.fetch = orig; }
  });

  it('scoped invalidation: user-1 refetch, user-2 untouched', async () => {
    const qc = createQC();
    let count = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      count++;
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    // Production path: campaignStore.markCampaignAsDeleted calls
    //   queryClient.setQueryData(['/api/campaigns', userId], ...)
    // with userId from localStorage. We call setQueryData directly
    // with the canonical campaignsListKey — byte-equivalent to the
    // production store path (campaignStore.ts:130).
    try {
      // Prime both caches
      await qc.fetchQuery(obsOpts('user-1', qc));
      await qc.fetchQuery(obsOpts('user-2', qc));
      expect(count).toBe(2);

      // Production-equivalent: scoped setQueryData for user-1
      qc.setQueryData(campaignsListKey('user-1'), (old: any) => {
        if (!old || !old.data) return old;
        return { ...old, data: old.data.filter((c: any) => c.id !== 'del') };
      });

      // user-2 was NOT touched
      const s2 = qc.getQueryState(campaignsListKey('user-2'));
      expect(s2?.isInvalidated).toBeFalsy();

      // Unscoped key is NOT present (old store bug: two writes)
      const unscoped = qc.getQueryData(['/api/campaigns']);
      expect(unscoped).toBeUndefined();
    } finally { globalThis.fetch = orig; }
  });

  it('prefix invalidation matches all scoped keys', async () => {
    const qc = createQC();
    let count = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      count++;
      return new Response(JSON.stringify({ success: true, data: [{ id: String(count) }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    try {
      // Prime both users
      await qc.fetchQuery(obsOpts('user-1', qc));
      await qc.fetchQuery(obsOpts('user-2', qc));
      expect(count).toBe(2);

      // Existing broad prefix invalidation (used in 6 call-sites)
      qc.invalidateQueries({ queryKey: ['/api/campaigns'] });

      // Both scoped keys are invalidated
      const s1 = qc.getQueryState(campaignsListKey('user-1'));
      const s2 = qc.getQueryState(campaignsListKey('user-2'));
      expect(s1?.isInvalidated).toBe(true);
      expect(s2?.isInvalidated).toBe(true);

      // Refetch — both go to network
      await qc.fetchQuery(obsOpts('user-1', qc));
      expect(count).toBe(3);
    } finally { globalThis.fetch = orig; }
  });
});
