# Claude handoff: VK token-webhook follow-up

Base: `5a16ea4705b6121f66244be44f1f4e8408079c36`

Branch: `codex/vk-webhook-followup`

## Architectural constraint

Keep the permanent per-campaign webhook URL introduced in `5a16ea470`. It fixes
the real needanapp contract: needanapp stores one URL and reuses it for future
token refreshes. Rotation is explicit only; ordinary `prepare` must keep returning
the same URL.

## Implemented

1. `VkTokenBanner` no longer references an out-of-scope `token`. Authenticated
   prepare/status requests live in `client/src/lib/vk-token-webhook.ts`.
2. Directus network/timeout/408/425/429/5xx errors return 503 from callback,
   prepare, rotate, revoke, reconnecting and status. Public callback still maps
   non-transient response errors to the uniform 403.
3. First `prepare` is serialized per campaign in the current Node process.
   The queue stores no secrets and deletes its Map entry after the last operation.
   Callback writes, reconnecting, rotate/revoke and async refresh preservation use
   the same lock, so an in-flight callback cannot restore a rotated/revoked secret.
   The permanent secret itself remains in Directus.
4. Added authenticated + tenant-guarded lifecycle endpoints:
   - `POST /api/vk/token-webhook/:campaignId/rotate`
   - `DELETE /api/vk/token-webhook/:campaignId/secret`
   Rotate returns a new stable URL and immediately invalidates the old one.
   Revoke disables callback writes without deleting the already stored VK token.
5. Generic campaign settings merge cannot replace `webhookSecret`; only the
   server lifecycle routes can generate/change it.
6. The broad global rate-limit exception no longer matches authenticated
   `/vk/token-webhook/...` control routes. The public submit callback remains on
   its separate early limiter.

## Regression evidence

Before implementation the new targeted suite was red:

- Directus 429/500/503 callback cases returned 403;
- prepare Directus 503 returned 500;
- two concurrent initial prepares returned different secrets;
- rotate/revoke returned 404 because the endpoints did not exist;
- the client compiler guard reported four `TS2304: Cannot find name 'token'`;
- generic settings merge accepted a weak client-supplied webhook secret.

After implementation:

- targeted: 5 files / 46 tests passed; the VK route file has 31 tests;
- full: 101 files / 1073 tests passed;
- `npm run check`: passed;
- `npm run build`: passed.

Mutation proof: removing `ensureCampaignAccess` from rotate changes the foreign
tenant route test from expected 404/no admin calls to actual 200/admin mutation.
The guard was restored after the check.

`npm run check:production` remains red on the repository's existing large
TypeScript backlog. No diagnostic shown for the changed VK files; the dedicated
`VkTokenBanner.compile.test.ts` protects the concrete unresolved-identifier class
that the normal build does not type-check.

## Items for Claude to review or finish

1. The initialization lock is deliberately process-local because production is
   currently one Node process. If horizontal scaling is enabled, replace it with
   an atomic Directus/DB initialization or distributed lock.
2. Rotate/revoke are API controls; no UI buttons were added. Wire them into the
   ownership-transfer/disconnect workflow if such a workflow exists.
3. Confirm the active reverse proxy does not write
   `/api/vk/token-webhook/.../submit/<secret>` to access logs. Node's HTTP logger
   is after the public bypass and does not see successful callbacks, but proxy
   configuration is outside this repository.
4. Do a final diff review, rerun all three mandatory checks, then commit/push/
   deploy according to `docs/DEPLOYMENT.md`.
