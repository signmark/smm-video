# Analytics observability follow-up — 2026-07-20

Status: **READY FOR SECOND PAIR OF EYES**

Implementer: Codex  
Verifier / commit / push owner: Mavis (Minimax), per the current team workflow  
Commit and push: **not performed by Codex**

## Production diagnosis

The production UI and logs were checked against two real campaign configurations.

- Campaign `Чушь` (`3edd0b3b-a96b-484c-9499-78b6de374c10`) has only VK configured, so a VK-only analytics result is expected.
- Campaign `omemo.tech` (`4513f574-80da-4bbe-8c47-771c63b5d1cb`) has Telegram, VK, Instagram, Facebook, Threads, and YouTube configured.
- For `omemo.tech`, the SMM backend sends scraper requests for both Telegram and VK.
- Instagram, Facebook, Threads, and YouTube are not supported by the current analytics scraper integration. They were silently omitted.
- Telegram can also disappear from the final UI result when channel resolution fails, both scraper calls fail, or the selected period contains no usable data. Existing production-visible logs showed the outbound request but did not explain which of these branches was taken.

This change adds observability only. It does not claim or implement scraper analytics support for Instagram, Facebook, Threads, or YouTube.

### Telegram `22 views` finding

The suspicious Telegram card showing `11 posts / 22 views` was checked directly
against the scraper response for channel `@ya_delayu_moschno`.

- The response contains 11 unique post IDs in the selected period.
- Every unique post has exactly `views: 2`.
- SMM correctly deduplicates repeated snapshots and then sums current per-post
  counters: `11 × 2 = 22`.
- Therefore, `22` does **not** mean 22 distinct people. It is the sum of Telegram
  post-view counters. The same account viewing 11 posts contributes 11 views.
- Repeated captures on July 16, 18, 19, and 20 retain the same value of 2, so this is
  not evidence of a stream of new readers.

Telegram's post API exposes a counter, not viewer identities. One view is plausibly
the owner's reading session; the second strongly resembles a technical view caused by
the publishing or scraper Telegram user session. This cannot be proved from aggregate
responses alone.

Scraper-owner follow-up:

1. Audit the Telegram collector for `messages.getMessagesViews` and ensure
   `increment=false` whenever metrics are read.
2. Audit any browser/Telegram-user session that opens the channel viewport while
   parsing.
3. Reproduce on a fresh isolated channel with one post and no human readers.
4. Do not compensate by blindly subtracting one until the technical increment is
   reproduced and attributed.
5. Rename the SMM UI metric to `Суммарные просмотры постов` (or add a tooltip) so it
   is not interpreted as unique viewers.

No force-parse was triggered during this diagnosis because it could itself increment
the Telegram counter and contaminate the evidence.

## Implemented

Files:

- `server/services/analytics-service.ts`
- `server/__tests__/analytics-scraper-matching.test.ts`

Production-visible structured events now use:

```text
analytics trace={"event":"...", ...}
```

Events:

- `campaign_plan`
  - known platform settings that are present;
  - Telegram/VK candidates;
  - whether a cached scraper channel ID exists;
  - platforms skipped with an explicit reason.
- `channel_resolution_start`
- `channel_response_summary`
  - date range;
  - whether `/analytics` returned a response;
  - whether `/posts` returned a response;
  - raw row count and deduplicated post count;
  - selected source (`posts_dedup` or `analytics_fallback`);
  - aggregate counters used by SMM.
- `channel_skipped`
  - `channel_resolution_failed`;
  - `no_scraper_response`;
  - `empty_period_data`;
  - plus campaign-level configuration failures.
- `channel_included`
- `campaign_result`

Explicit configuration reasons:

- `unsupported_by_analytics_scraper`
- `missing_public_username`
- `invalid_group_id`

The trace deliberately does **not** serialize `social_media_settings`, access tokens,
refresh tokens, Authorization headers, or post bodies/text.

## Verification

Passed:

```text
npx vitest run server/__tests__/analytics-scraper-matching.test.ts \
  server/__tests__/analytics-service.test.ts \
  server/__tests__/analytics-refresh.test.ts

3 files, 16 tests passed
```

```text
npx vitest run

69 files, 718 tests passed
```

```text
npx eslint server/services/analytics-service.ts \
  server/__tests__/analytics-scraper-matching.test.ts

0 errors; existing no-explicit-any warnings only
```

The repository-wide `npx tsc --noEmit` still fails on the existing broad TypeScript
baseline. After correcting one local inference issue, its output contains no errors
for either changed file.

`git diff --check` passes.

## Second-pair review checklist

1. Confirm the use of warning-level output is intentional: this repository suppresses
   all ordinary `info` logs in production, while analytics request diagnostics already
   use the production-visible `analytics` warning channel.
2. Confirm no payload can contain platform settings or post content.
3. Confirm `campaign_plan` reports the four unsupported configured platforms for
   `omemo.tech`.
4. Confirm an empty Telegram response yields:
   - `channel_response_summary`;
   - then `channel_skipped` with either `no_scraper_response` or `empty_period_data`.
5. Commit only after the second-pair review. Suggested message:

```text
chore(analytics): add safe production diagnostics
```

## Manual check after deployment

Open analytics for campaign `omemo.tech`, switch between 7 and 30 days, then inspect:

```text
docker logs --tail 300 smm 2>&1
```

Expected:

- `campaign_plan` lists Telegram and VK as candidates;
- Instagram, Facebook, Threads, and YouTube are listed as
  `unsupported_by_analytics_scraper`;
- each Telegram/VK candidate has a response summary;
- the final inclusion or skip reason is explicit;
- no credentials or post content appear in these new trace lines.

## Separate urgent security follow-up (not fixed here)

During read-only production diagnosis, an unrelated existing YouTube settings log was
observed emitting OAuth credential fields, including access and refresh tokens. No
credential values are copied into this artifact.

This should be handled as a separate urgent security fix:

- remove or redact the YouTube settings response/body log;
- search production-visible logs for other serialized platform settings;
- rotate exposed YouTube credentials if the logs are accessible beyond the minimum
  trusted operator set;
- do not combine that change with this analytics observability patch.
