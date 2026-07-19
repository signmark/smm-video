# Task: Real analytics with `analyticsChannelId` + remove manual refresh button

## Context

Working in `G:\Projects\smm-video` (Node.js + TypeScript + Express + Directus + Vitest + TanStack Query on the client).

The user wants two related changes:

1. **Stop pretending manual refresh works.** Today, the "Обновить данные" button on the analytics page calls `POST /api/analytics/update` which kicks off a `force-parse` + `metrics-refresh` in the scraper and **returns immediately (fire-and-forget)** — the UI never knows when the data is actually fresh. The toast says "started" but the on-screen numbers are still the stale ones. The scraper updates metrics every 6 hours anyway, so this button is theatre. **Remove it.**

2. **Store scraper's channel UUID in our campaign settings.** Today, mapping from `social_media_settings` → scraper channel requires either fuzzy heuristics (Telegram: parse `@username` from `chatId`; VK: parse numeric `groupId`) or a `getAllMonitoredChannels` lookup by `platform_channel_id`. We already `POST` to register a channel in `ensureChannelsRegistered` and **the response includes the scraper's UUID** — we just throw the mapping away. Cache the UUID in `social_media_settings.{platform}.analyticsChannelId` and use it as the primary lookup.

The `refreshCampaignAnalytics` flow (which the button currently calls) will still exist for admin use via curl; just no UI button.

---

## 1. Schema changes

### `shared/schema.ts` (around line 91)

Extend `SocialMediaSettings` — add `analyticsChannelId?: string | null` to both `telegram` and `vk`:

```ts
telegram?: {
  token?: string | null;
  chatId?: string | null;
  analyticsChannelId?: string | null;   // ← NEW: UUID in scraper
  [key: string]: any;
};
vk?: {
  token?: string | null;
  groupId?: string | null;
  analyticsChannelId?: string | null;   // ← NEW
  [key: string]: any;
};
```

JSON field in Directus — no migration needed, it'll just appear.

---

## 2. Backend: lookup + save-back

### `server/services/scraper-analytics.ts`

The helper `getScraperCampaignChannels` (line 97) **stays as a fallback** for campaigns that haven't been migrated yet, but its callers should prefer the new field.

**Add two new helpers** near the other channel-management functions:

```ts
/**
 * Persist scraper UUID back into the campaign's social_media_settings.{platform}
 * so we don't have to look it up next time. Fire-and-forget — must not block
 * the analytics response if Directus is slow.
 */
export async function persistAnalyticsChannelId(
  campaignId: string,
  platform: 'telegram' | 'vk',
  channelId: string,
  adminToken: string,
): Promise<void> {
  if (!campaignId || !channelId) return;
  const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
  try {
    // Read current settings (to merge, not overwrite)
    const cur = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 10_000,
    });
    const socialSettings = cur.data?.data?.social_media_settings || {};
    const platformSettings = socialSettings[platform] || {};
    if (platformSettings.analyticsChannelId === channelId) return; // no-op
    platformSettings.analyticsChannelId = channelId;
    socialSettings[platform] = platformSettings;
    await axios.patch(`${directusUrl}/items/user_campaigns/${campaignId}`,
      { social_media_settings: socialSettings },
      { headers: { Authorization: `Bearer ${adminToken}` }, timeout: 10_000 },
    );
    log(`[ScraperAnalytics] 💾 Saved ${platform} analyticsChannelId=${channelId} for campaign ${campaignId}`, 'info');
  } catch (e: any) {
    log.warn(`[ScraperAnalytics] persistAnalyticsChannelId failed: ${e.message}`, 'analytics');
  }
}
```

**Add a single new function** that resolves a campaign's channel to a scraper UUID, handling all three cases (cached, lookup, register):

```ts
/**
 * Resolve a campaign's platform channel to a scraper UUID, with persistence.
 * Returns null if neither lookup nor registration succeeded.
 *
 * Resolution order:
 *   1. social_media_settings.{platform}.analyticsChannelId (cached)
 *   2. GET /monitoring/channels filtered by platform_channel_id
 *      (existing heuristic: telegram chatId starting with @, vk numeric groupId)
 *   3. POST /monitoring/channels to register
 *
 * On a successful (2) or (3), persists the UUID back via persistAnalyticsChannelId.
 */
export async function resolveAnalyticsChannel(
  platform: 'telegram' | 'vk',
  platformChannelId: string,
  cachedId: string | null | undefined,
  campaignId: string,
  adminToken: string,
  campaignName?: string,
): Promise<string | null> {
  // 1. Cached
  if (cachedId) return cachedId;

  // 2. Lookup by platform_channel_id
  try {
    const monitored = await getAllMonitoredChannels({ platform }, true);
    const found = monitored.items.find(c => c.platform_channel_id === platformChannelId);
    if (found?.id) {
      // fire-and-forget save-back
      void persistAnalyticsChannelId(campaignId, platform, found.id, adminToken);
      return found.id;
    }
  } catch (e: any) {
    log.warn(`[ScraperAnalytics] resolveAnalyticsChannel lookup failed: ${e.message}`, 'analytics');
  }

  // 3. Register
  try {
    const created = await createMonitoringChannel({
      platform,
      platform_channel_id: platformChannelId,
      name: campaignName,
    }, true);
    if (created?.id) {
      log(`[ScraperAnalytics] Registered ${platform}:${platformChannelId} → ${created.id}`, 'info');
      void persistAnalyticsChannelId(campaignId, platform, created.id, adminToken);
      return created.id;
    }
  } catch (e: any) {
    log.warn(`[ScraperAnalytics] resolveAnalyticsChannel register failed: ${e.message}`, 'analytics');
  }

  return null;
}
```

> Note: `createMonitoringChannel` already exists at line 404. `getAllMonitoredChannels` at line 382. `getChannelAnalytics` at line 466 — accepts a UUID directly.

---

### `server/services/analytics-service.ts`

**`supplementFromScraper`** (around line 128 — the private method that augments Directus-stored metrics with scraper data):

Replace the loop body that does:
```ts
const found = monitored.items.find(m => m.platform === ch.platform && m.platform_channel_id === ch.platformId);
if (!found) continue;
const analytics = await getChannelAnalytics(found.id, ...);
```

with the new resolver. The new code path becomes:

```ts
for (const ch of channelsToLookup) {
  const platformSettings = (typeof socialSettings === 'object' ? socialSettings : {})?.[ch.platform] || {};
  const cachedId = platformSettings.analyticsChannelId;
  const scraperChannelId = await resolveAnalyticsChannel(
    ch.platform, ch.platformId, cachedId, campaignId, adminToken, campaign.name,
  );
  if (!scraperChannelId) continue;
  const analytics = await getChannelAnalytics(scraperChannelId, { from_date: fromStr, to_date: toStr });
  if (!analytics) continue;
  // ... rest unchanged (the hasScraperData guard from commit 0d117a5 stays)
}
```

Keep the `hasScraperData` guard from commit `0d117a5` — it correctly handles "scraper knows the channel but has no data for the period yet".

### `server/services/analytics-service.ts` — `refreshCampaignAnalytics`

This function (called by `/api/analytics/update` for admin use) currently calls `ensureChannelsRegistered` and **discards the result**. Fix it to use the new resolver too, and propagate the actual `id` into `channelObjects`:

```ts
for (const ch of channelsToLookup) {
  const platformSettings = (typeof socialSettings === 'object' ? socialSettings : {})?.[ch.platform] || {};
  const scraperChannelId = await resolveAnalyticsChannel(
    ch.platform, ch.platformId, platformSettings.analyticsChannelId, campaignId, adminToken, campaign.name,
  );
  if (!scraperChannelId) continue;
  const parseStatus = await getChannelParseStatus(scraperChannelId, true);
  // ... existing parse-status + force-parse logic, but use scraperChannelId everywhere
  channelObjects.push({
    id: scraperChannelId,
    platform: ch.platform,
    platform_channel_id: ch.platformId,
  });
}
```

`ensureChannelsRegistered` itself **stays** (other callers might use it) but this function no longer calls it — `resolveAnalyticsChannel` does the work.

---

## 3. Frontend: remove both buttons, no polling

### `client/src/pages/analytics/index.tsx`

Delete entirely:
- `useMutation` block for `updateAnalyticsMutation` (lines ~60–95)
- `const [isRefreshing, setIsRefreshing] = useState(false)` and `handleRefreshData` (lines ~96–124)
- Both `<Button>` blocks in the header (lines ~336–365):
  - "Обновить данные" (uses `updateAnalyticsMutation`)
  - "Пересобрать данные" (uses `handleRefreshData` / `refetch()`)
- Unused imports: `RefreshCw`, `Database`, possibly `useMutation` if no other usage

Keep and tweak the `useQuery` for `/api/analytics/${selectedCampaign}`:
```ts
const { data: analyticsData, isLoading, error, refetch } = useQuery<AnalyticsData>({
  queryKey: ['analytics', selectedCampaign, selectedPeriod],
  enabled: !!selectedCampaign,
  refetchOnWindowFocus: true,   // ← already in TanStack default, make it explicit
  refetchOnMount: true,         // ← explicit: fetch on every Analytics page open
  staleTime: 0,                 // ← always treat data as stale → fresh fetch on enter
  queryFn: async () => { /* same as today */ },
});
```

**No `refetchInterval` polling** — the user explicitly does not want background polling. Fresh data on page open + window-focus refetch is enough.

### `client/src/locales/ru.json`

Remove the now-unused keys (search for `refreshData`, `updateData`, `rebuildData`, `recalculateData`, `updating`, `dataUpdated`, `partiallyUpdated`, `refreshStarted`, `rebuilding`). Keep nothing that referenced the deleted buttons. Verify no other locale file uses them.

---

## 4. Backend route: keep but mark deprecated

### `server/routes/analytics.ts` (line 16)

Keep `POST /api/analytics/update`. Update its JSDoc to:
```
/**
 * Admin-only: принудительный refresh метрик через scraper.
 * UI больше не вызывает — данные подтягиваются на входе на страницу Аналитики.
 * Endpoint оставлен для ops (расследование инцидентов, тесты).
 */
```

Do not remove — deleting it is a separate concern, and the route has no UI consumer anymore so it's a small risk to keep.

---

## 5. Tests

### `server/services/scraper-analytics.ts` — new test file or extend existing

`server/__tests__/scraper-analytics-resolve.test.ts` (new) with cases:
- **Cached:** if `social_media_settings.telegram.analyticsChannelId` is set, returns it without any HTTP call.
- **Lookup:** if not cached but channel exists in `getAllMonitoredChannels`, returns its `id` **and** triggers a PATCH to Directus (mock `axios.patch`, assert call).
- **Register:** if not cached and not in monitored list, `POST /monitoring/channels` and persist the response `id`.
- **All fail:** returns `null` without throwing.
- **No-op save:** if cachedId === found id, no PATCH (avoid write-amplification).

### `server/services/analytics-service.ts` — extend `analytics-scraper-matching.test.ts`

- New case: when `social_media_settings.telegram.analyticsChannelId` is present, `getCampaignAnalytics` calls `getChannelAnalytics(uuid, ...)` directly (not via `getAllMonitoredChannels`).
- New case: when no `analyticsChannelId` is present and channel isn't in scraper, the resolver is invoked (auto-register).

### `server/services/analytics-service.ts` — extend `analytics-refresh.test.ts`

- The "channel already in scraper" case should now bypass the platform_channel_id search and use the resolver.
- The "channel not yet parsed" case should still force-parse using the resolved UUID.

### `client/src/pages/analytics/index.tsx`

No new test required (no test file currently, per repo style). If there's a snapshot test for this page, update it to remove the deleted buttons.

---

## Acceptance criteria

1. `git grep "updateAnalyticsMutation\|handleRefreshData\|analytics.updateData\|analytics.refreshData\|analytics.rebuildData" client/src/ server/` returns nothing (except deleted-but-still-referenced → must be zero).
2. `npx vitest run server/__tests__/scraper-analytics-resolve.test.ts server/__tests__/analytics-scraper-matching.test.ts server/__tests__/analytics-refresh.test.ts` → all green.
3. Open Analytics page for a campaign **without** `analyticsChannelId` set in `social_media_settings`:
   - First load: registers (or finds) the channel in scraper, persists UUID, returns data.
   - Second load: skips registration, uses cached UUID directly.
4. Open Analytics page for a campaign **with** `analyticsChannelId` set: zero scraper registration calls, single `getChannelAnalytics` call per platform.
5. No `refetchInterval` in the analytics `useQuery` config.
6. Both header buttons gone from the rendered DOM (`grep` the rendered JSX if you have a snapshot).
7. The "Пересобрать данные" locale keys are gone from `ru.json` (and any other locale file).

---

## Out of scope

- Do **not** add `force-parse` / `metrics-refresh` calls anywhere — that was the whole point of removing the button. The scraper runs them on its own schedule.
- Do **not** remove `ensureChannelsRegistered` or the `/api/analytics/update` route — they stay for admin/legacy.
- Do **not** touch the untracked docs in `_archive/docs/` or `docs/SCRAPER_API_INTEGRATION_ISSUES_ROMA.md`.
- Do **not** add WebSockets / SSE — the user explicitly rejected polling, so don't reach for a heavier real-time solution.

---

## How to verify locally

```powershell
cd G:\Projects\smm-video
npx vitest run server/__tests__/scraper-analytics-resolve.test.ts server/__tests__/analytics-scraper-matching.test.ts server/__tests__/analytics-refresh.test.ts
git diff --stat
git grep -E "updateAnalyticsMutation|handleRefreshData|analytics.updateData|analytics.refreshData|analytics.rebuildData" client/src/ server/
```

---

## Commit message (one commit for the whole thing, or split per concern if you prefer)

```
feat(analytics): cache scraper channel UUID, drop manual refresh button

- Add social_media_settings.{telegram,vk}.analyticsChannelId
- New resolveAnalyticsChannel(): cached → lookup → register, with
  fire-and-forget persist back to Directus
- supplementFromScraper and refreshCampaignAnalytics use the new resolver
- UI: remove "Обновить данные" and "Пересобрать данные" buttons,
  remove their mutations, drop refetchInterval, rely on page-mount
  + window-focus refetch via TanStack Query
- /api/analytics/update kept for admin (mark deprecated for UI)
- Tests: new resolveAnalyticsChannel cases, extend existing matching
  and refresh tests
```
