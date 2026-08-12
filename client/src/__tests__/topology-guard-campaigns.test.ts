/**
 * Task #10: Topology guard — all list-consumers use canonical campaignsListKey.
 *
 * Verifies: no raw `queryKey: ['/api/campaigns']` (without userId) in any
 * consumer; no raw `refetchInterval` on campaign list queries.
 *
 * Red-before on main: all assertions fail because each consumer uses its own
 * raw key or polling. Green after migration to useCampaignsList().
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');

// Files known to contain campaign list consumers
const LIST_CONSUMERS = [
  'client/src/pages/campaigns/index.tsx',
  'client/src/pages/dashboard/index.tsx',
  'client/src/pages/keywords/index.tsx',
  'client/src/pages/publish/scheduled.tsx',
  'client/src/pages/publish/test-publish.tsx',
];

// Already-migrated consumers (use the hook)
const HOOK_CONSUMERS = [
  'client/src/components/CampaignSelector.tsx',
  'client/src/pages/content/index.tsx',
];

// Store file with unscoped write (now fixed)
const STORE_FILE = 'client/src/lib/campaignStore.ts';

function readFile(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf-8');
}

describe('task #10: topology guard — no raw list keys', () => {
  for (const file of LIST_CONSUMERS) {
    it(`${file}: does not use raw queryKey ['/api/campaigns'] without userId`, () => {
      const content = readFile(file);
      // After migration, every list consumer uses useCampaignsList()
      expect(content).toContain('useCampaignsList');
      // Raw unscoped key must not appear in list consumers
      const hasRawKey = /queryKey\s*:\s*\[['"]\/api\/campaigns['"]\]/.test(content);
      expect(hasRawKey).toBe(false);
    });
  }

  for (const file of LIST_CONSUMERS) {
    it(`${file}: does not use refetchInterval for campaign list`, () => {
      const content = readFile(file);
      // No polling on campaign list after migration
      expect(content).not.toMatch(/refetchInterval/);
    });
  }

  it('campaignStore: no unscoped setQueryData on raw key', () => {
    const content = readFile(STORE_FILE);
    // The unscoped write was removed; only scoped ['/api/campaigns', userId] remains
    const unscopedWrite = /setQueryData\(\[['"]\/api\/campaigns['"]\]/.test(content);
    expect(unscopedWrite).toBe(false);
  });

  it('hook consumers already use useCampaignsList', () => {
    for (const file of HOOK_CONSUMERS) {
      const content = readFile(file);
      expect(content).toContain('useCampaignsList');
    }
  });
});
