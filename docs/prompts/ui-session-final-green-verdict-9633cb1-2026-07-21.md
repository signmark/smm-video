# UI/session final verdict for `9633cb1` — 2026-07-21

**Follow-up to:** `080f548`  
**Reviewed commit:** `9633cb1`  
**Verdict:** **GREEN** for the UI/session and YouTube OAuth blockers tracked by this review.

## 1. Forged-JWT protection on YouTube OAuth routes — GREEN

All three YouTube helper routes now use `authenticateUser` from `server/middleware/user-auth.ts`:

- `POST /api/youtube/auth/start`;
- `POST /api/youtube/test`;
- `POST /api/youtube/fix-redirect-uri`.

Unlike the removed legacy `authMiddleware`, `authenticateUser` validates the presented access token against Directus before populating `req.user`, distinguishes an invalid session from temporary validation failure and does not trust a decoded JWT payload as identity. A forged JWT containing a victim owner ID can therefore no longer reach `authorizeCampaignAccess` or create authoritative server-side OAuth state.

The callback protections from `79ab54e` remain intact: campaign ID comes only from server-side state, ownership is rechecked before admin write, and `saved=true` is emitted only after successful storage.

## 2. Central invalid/unavailable event delivery — GREEN

`refreshAuthSession` is now the single emission point for `invalid` and `unavailable`:

- missing refresh token emits `invalid` immediately;
- a completed shared refresh promise emits the resulting `invalid`/`unavailable` once;
- `refreshAccessToken` no longer duplicates these events.

This covers every caller, including QueryClient and the Directus axios interceptor, because both call `refreshAuthSession`. AuthGuard's existing subscription therefore receives the same lifecycle result for initial checks, timers and ordinary API-triggered refresh attempts. Invalid sessions lead to explicit login handling; unavailable preserves credentials and activates the recoverable retry UI.

The refresh regression test verifies both statuses and their dispatched event details. Existing single-flight logic means concurrent callers share the same promise and do not emit duplicate completion events.

## Regression status from previous verdicts

- late `401` mutation is never replayed under another account — GREEN;
- late `200` from a previous browser session is rejected — GREEN;
- Web Locks same-session refresh synchronizes Zustand without logout — GREEN;
- account-switch refresh response cannot overwrite the new session — GREEN;
- `/api/auth/me` cold-refresh race — GREEN;
- `checkIsAdmin` no longer destroys a recoverable refresh token — GREEN;
- sanitized YouTube/Instagram UI flow — GREEN;
- authoritative YouTube callback state and save failure handling — GREEN.

## Verification

Executed:

```text
npm.cmd test -- --run
  client/src/lib/__tests__/queryClient-session.test.ts
  client/src/lib/__tests__/refreshAuth.test.ts
  server/__tests__/directus-refresh-service.test.ts
  server/__tests__/directus-session-validator.test.ts
  server/__tests__/user-auth-session.test.ts
  server/__tests__/youtube-settings-log-redaction.test.ts
  server/__tests__/oauth-response-sanitizer.test.ts
```

Result: **7 test files / 32 tests passed**.

```text
npm.cmd run check
```

Result: **passed** (`tsc -p tsconfig.critical.json`).

## Non-blocking follow-ups

- Add a router-level test that submits a syntactically valid JWT with a forged owner ID to each YouTube helper route and asserts `401`; current coverage verifies `authenticateUser` separately and the routes' direct middleware binding by inspection.
- Add an AuthGuard component test that observes the recoverable screen after an API-triggered `unavailable` event. Current refresh test verifies event dispatch, while AuthGuard subscription is verified by inspection.
- Consider restricting or production-disabling `/youtube/fix-redirect-uri`; it mutates global configuration and currently requires a valid user session but not an explicit admin role. This is defense-in-depth outside the two blockers assigned to this follow-up.

## Release gate

The blockers from `7c159a8` and `080f548` are closed. This reviewer has no remaining UI/session release blocker for the reviewed range.
