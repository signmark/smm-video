# Final security follow-up for `efff09e`

**Date:** 2026-07-21  
**Reviewer:** Codex security re-review  
**Reviewed product commit:** `efff09ed9b026565d6d3f6d35fd2f095357c1632` (after `9633cb1`)  
**Scope:** H-04, H-05, H-06, K-01; regression confirmation for C-04  
**Verdict:** **BLOCKED — one residual H-04 credential-key gap**

No product code was changed during this review. The current unrelated credential-purge worktree changes and untracked webbridge files were not staged or included in this verdict.

## Release blocker

### H-04 residual — legacy Telegram bot-token aliases survive the recursive sanitizer

The new sanitizer correctly removes the OAuth keys named in the previous verdict, recursively, and is applied to campaign list/get/patch plus Facebook, Instagram, Threads and VK settings responses. The write path also recursively merges sanitized client updates with stored settings, so omitted server-side OAuth secrets are retained.

However, the committed `SECRET_KEYS` set does not include normalized `bottoken` (`server/services/oauth-response-sanitizer.ts:23-26`). The active publishing code explicitly accepts `tgSettings.botToken` as a credential (`server/api/social-publishing-router.ts:2453`). Therefore a legacy campaign value such as `social_media_settings.telegram.botToken` passes unchanged through:

- campaign list: `server/routes/campaigns.ts:165-166`;
- campaign get: `server/routes/campaigns.ts:213-214`;
- campaign patch response: `server/routes/campaigns.ts:261`.

That returns a live Telegram bot credential to the browser and contradicts the sanitizer's stated invariant that credential material is removed at any depth. This is a concrete stored-data compatibility path, not a hypothetical arbitrary key.

Required closure: add normalized `bottoken` (covering both `botToken` and `bot_token`) and `telegrambottoken` to `SECRET_KEYS`, with a nested regression assertion. Those exact changes are already present as an **uncommitted follow-up** in the shared worktree, but they are not part of `efff09e` and therefore cannot be credited to this commit.

## Closed findings

### H-05 — Facebook token transport and response exposure: CLOSED

- Pages, debug and groups discovery use authenticated POST bodies rather than GET query tokens.
- All three routers set `Cache-Control: no-store` and sanitize returned Facebook accounts.
- Static grep found no `?token=` or `?access_token=` construction for these Facebook client/server routes at `efff09e`.
- Production debug access is non-enumerating admin-only (`server/routes/facebook-debug.ts:13-15`).
- Page-token exchange is authenticated, authorizes the campaign, stores page/user tokens server-side and returns only metadata plus `hasAccessToken` (`server/api/facebook-webhook-unified.ts:264-332`).

### H-06 — Instagram webhook credential bundle: CLOSED

- The webhook destination is taken only from `INSTAGRAM_WEBHOOK_URL` and must use HTTPS (`server/routes/instagram-oauth.ts:47-50`).
- The callback constructs a separate notification DTO containing campaign/app identifiers, limited user metadata, sanitized Instagram accounts, expiry and timestamp; it does not send `longLivedToken`, `appSecret`, raw pages or page access tokens (`server/routes/instagram-oauth.ts:352-361`).
- Auth URL, state value and session-key logging were removed.
- OAuth sessions use a ten-minute TTL, are pruned before insertion, and are deleted on callback success/failure (`server/routes/instagram-oauth.ts:13-18, 55, 134-137, 378, 405`).
- The existing authoritative start ownership gate and callback re-check/fail-closed storage path remain intact.

### K-01 — decode-only legacy middleware: CLOSED

`server/middleware/auth.ts:6` is now only a compatibility alias that exports authoritative `authenticateUser` as `authMiddleware`. Existing publishing/upload/TikTok imports therefore validate the bearer session through Directus instead of decoding an unverified JWT. C-04 remains closed for the same reason on the YouTube OAuth routes.

## Checks performed

- Targeted Vitest: **5 files passed, 26 tests passed**:
  - `oauth-response-sanitizer.test.ts`
  - `youtube-settings-log-redaction.test.ts`
  - `directus-session-validator.test.ts`
  - `user-auth-session.test.ts`
  - `analytics-service.test.ts`
- `npm.cmd run check`: **passed** (`tsconfig.critical.json`).
- `npm.cmd run build`: **passed**; only existing Vite mixed-import/chunk-size warnings were emitted.
- `git diff --check efff09e^..efff09e`: **passed**.
- Static route tracing confirmed POST/body/no-store/sanitized Facebook contracts, the HTTPS-configured minimized Instagram webhook, authoritative legacy auth alias, and campaign/settings sanitizer call sites.

Coverage note: `efff09e` adds sanitizer unit coverage but not route-level negative tests for the Facebook query-token rejection, campaign DTO recursion, or Instagram webhook sentinel exclusion. Static tracing closes the reviewed vulnerabilities, but those route tests remain recommended regression hardening.

## Release decision

Do not treat `efff09e` alone as GREEN. Commit the prepared bot-token alias follow-up, rerun the sanitizer test and critical typecheck, then re-evaluate H-04. H-05, H-06, K-01 and C-04 need no further product fix from this review.

H-07 credential purge and real-world credential rotation/revocation are intentionally outside this commit verdict and remain separate release work.
