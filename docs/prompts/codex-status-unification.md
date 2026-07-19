# Task B: unify `partial` / `partially_published` status

## Context

Working in `G:\Projects\smm-video` (Node.js + TypeScript + Express + Directus + Vitest).

The codebase has two synonymous statuses for "partially published" content,
and the read-side filters treat them differently — so a row with one status
can be invisible to a query that uses the other.

| Writes | File | Lines |
|---|---|---|
| `'partially_published'` | `server/api/social-publishing-router.ts` | via `getContentPublicationStatus` |
| `'partially_published'` | `server/api/clips-publishing-router.ts` | ~168 |
| `'partial'` | `server/services/publish-scheduler.ts` | 733, 735 |
| Reads | File | Lines |
| Both | `server/services/publish-scheduler.ts` | 254 (filter `_in: ['scheduled','partial','pending','partially_published']`) |
| Both | `server/services/analytics-service.ts` | 20 (filter `_in: ['published','partially_published','partial']`) |
| Both | `client/src/lib/published-content.ts` | `PUBLISHED_CONTENT_STATUSES` |
| **Only `'partial'`** (loses `partially_published` rows) | `server/storage.ts` | 1285 |
| **Only `'partial'`** | `server/services/directus-storage-adapter.ts` | 286 |

The shared helper `getContentPublicationStatus` (`shared/schedule-time.ts`)
returns the **canon** `'partially_published'`. The router uses it correctly.
The scheduler still writes the legacy `'partial'` in two places. Two
storage-layer filters read only `'partial'`, so a row that arrives with
`'partially_published'` is filtered out — they silently miss content.

This prompt is **independent** of Task A (telegram-html) — they touch
different files and can run in parallel.

---

## What to do

The plan is conservative: do not migrate any data in Directus (no
mass UPDATE). Just make new writes use the canon, and let existing
`'partial'` rows continue to be read by the storage filters (backward
compat with whatever is already in the DB).

### 1. Fix the two writes in `server/services/publish-scheduler.ts`

Replace `'partial'` with `'partially_published'` at lines **733 and 735**:

```ts
// Line 733 area
const finalContentStatus = hasAnyPublished && allDone
  ? 'partially_published'    // ← was: 'partial'
  : hasAnyPublished && hasAnyPending
    ? 'partially_published'  // ← was: 'partial'
    : hasAnyPending
      ? 'scheduled'
      ...
```

Leave the surrounding comments as-is. Update the inline comments
(`// часть опубликована, ретраев нет`, etc.) — they don't reference
the string literal, but verify the logic still makes sense.

### 2. Extend the two read filters to include both values

Both filters exist to find "what's still actionable for the scheduler". A
row that ended up with `'partially_published'` (from the router path)
should be visible. **Do not** remove `'partial'` from the filter — old
rows in the DB still have that status and would be lost. Just add
`'partially_published'`.

`server/storage.ts:1285`:
```ts
// Before
status: { _in: ['scheduled', 'partial'] },

// After
status: { _in: ['scheduled', 'partial', 'partially_published'] },
```

`server/services/directus-storage-adapter.ts:286` — same change.

While you're at it, line 357 in the same file has a JS-side filter
using `'partial'` only:
```ts
const isScheduled = content.status === 'scheduled' || content.status === 'partial';
```
Extend it to also match `'partially_published'`. (Belt-and-suspenders —
Directus filters are the source of truth, but this in-memory check
should agree.)

### 3. Do NOT migrate data

Explicitly out of scope:
- No mass UPDATE on `user_campaigns` to rename `'partial'` →
  `'partially_published'`.
- No "fill `social_platforms.X.status` based on parent content status"
  backfill.
- No new admin endpoint to bulk-rename.

If the user wants a migration later, that's a separate prompt.

### 4. Tests

`server/__tests__/publish-scheduler-routing.test.ts` (the file in the
chronic-failures list — be aware it's flaky) may have cases that assert
the old `'partial'` literal. Update them to expect
`'partially_published'`. If any test asserts that the scheduler **reads**
content with `'partial'` status, that one stays — it tests backward
compatibility with legacy DB rows.

If a test elsewhere (e.g. `schedule-time.test.ts`,
`analytics-scraper-matching.test.ts`) imports from the scheduler and
asserts a status string, run it after your change and update as
needed.

Add a focused new test if one doesn't exist:
- Scheduler write path (the function containing line 733) →
  `finalContentStatus === 'partially_published'` when partial.
- `storage.ts` filter accepts both `'partial'` and
  `'partially_published'` rows. (Mock Directus call, assert the
  filter passed.)

### 5. Vitest baseline (REQUIRED REPORT)

Before starting work, run the full suite:

```powershell
npx vitest run 2>&1 | tee vitest-before.txt | Out-Null
```

Expected baseline: **9 failed files / 17 failed tests** on current
`main` (see `docs/prompts/baseline-vitest.txt` for the full list).
Files relevant to this prompt that should currently be green:
- `publish-scheduler*` tests (excluding `publish-scheduler-routing`
  which is in the chronic-failures list)
- `schedule-time.test.ts`
- `analytics-scraper-matching.test.ts`

If any of those are red before you start, stop and report.

After your changes, run again and **explicitly report**:
- Total: `Test Files X passed | Y failed (total)`
- Tests: `Tests N passed | M failed (total)`
- Delta vs baseline (any baseline failure you incidentally touched —
  you should not, but call it out)
- Any pre-existing failures still present (i.e. the 17 from baseline
  that this task does not own)

If `git grep -n "'partial'" server/` after your change still shows
writes (not reads) at lines 733/735, the task is not done.

---

## Acceptance criteria

1. `git grep -n "'partial'" server/ | grep -v __tests__` shows only
   read-side filters (storage.ts, directus-storage-adapter.ts); the
   two writes in publish-scheduler.ts are gone.
2. `git grep -n "'partially_published'" server/ | grep -v __tests__` shows
   the new writes in publish-scheduler.ts and at least one new read in
   each of the storage files.
3. `npx vitest run server/__tests__/publish-scheduler.test.ts
   server/__tests__/schedule-time.test.ts
   server/__tests__/analytics-scraper-matching.test.ts` — all green.
4. Full `npx vitest run` shows the same 9 baseline failures, no
   regressions.
5. No data migration was performed.
6. `git diff --check` clean.
7. No new `it.skip`.

---

## DO NOT FIX (conscious trade-offs)

- **Two write paths producing two statuses is a design choice for
  backward compat**, not a bug. We're not collapsing the data, we're
  aligning the producers.
- **`getContentPublicationStatus` returns `'partially_published'` as
  canon** — leave that helper alone.
- **`/publish/now` keeps `published_at = null` for partial content** —
  the per-platform fallback via `getPublishedDisplayDate` is the intended
  display path.
- **`hasScraperData` zero-aggregate skip in `supplementFromScraper`** —
  keep as-is from commit `0d117a5`.

---

## Out of scope

- Task A (`<pre>`/`<code>` preservation in `toTelegramHtml`)
- Tasks C and D (test cleanup)
- `client/src/lib/published-content.ts` already accepts both — leave it
  alone.
- Directus data migration
- `git push`

---

## How to verify locally

```powershell
cd G:\Projects\smm-video
npx vitest run server/__tests__/publish-scheduler.test.ts server/__tests__/schedule-time.test.ts server/__tests__/analytics-scraper-matching.test.ts
npx vitest run
git diff --stat
git grep -n "'partial'" server/ | grep -v __tests__
git grep -n "'partially_published'" server/ | grep -v __tests__
```

---

## Commit message

```
refactor(scheduler): unify partial / partially_published status writes

- publish-scheduler.ts now writes 'partially_published' (matches
  shared getContentPublicationStatus canon) instead of legacy 'partial'
- storage.ts and directus-storage-adapter.ts read filters extended
  to include both, so rows that arrive via the router path become
  visible to the scheduler
- In-memory isScheduled check in directus-storage-adapter.ts aligned
- No data migration; existing 'partial' rows continue to be read
- Tests updated to reflect new write value, read filters covered
```
