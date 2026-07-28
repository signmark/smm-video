---
name: oauth-token-management
description: Use when managing, integrating, or debugging OAuth2 token rotation, expiration thresholds, and background cron-jobs. Helps eliminate mathematical gaps and blind spots in token refresh.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [oauth, oauth2, token-rotation, refresh-token, vk-id, cron-jobs, background-workers]
    related_skills: [llm-api-proxying, systematic-debugging]
---

# OAuth Token Management & Rotation Playbook

## Overview
Many API integrations rely on OAuth2 where short-lived `access_tokens` are rotated using long-lived (or rotated) `refresh_tokens`. In modern strict APIs (like VK ID v2), the `refresh_token` itself can expire or is tightly bound to the current session. If the token expires without proactive rotation, the session is invalidated, forcing manual user re-authorization. This playbook covers optimal design patterns for token rotation, background cron checks, and troubleshooting.

## When to Use
- Designing background token refresh schedulers (cron jobs).
- Integrating OAuth2 authentication (VK ID, Instagram Graph, YouTube API).
- Debugging unexpected session invalidations or "token expired" permanent failures.

## The Cron Math Gap (Blind Spot Pattern)

A classic architectural pitfall when scheduling background token refreshes is setting a check interval that is larger than the refresh-before-expiry threshold.

### The Math Fallacy
Suppose your background task runs every $I$ hours (Interval), and you only refresh tokens that are expiring in the next $T$ hours (Threshold). If $I > T$, you create a **blind spot** of size $I - T$ hours:
1. At Cron Run $N$, a token has $T + \epsilon$ hours of life left (where $\epsilon < I - T$). Since $T + \epsilon > T$, the system skips it.
2. The next Cron Run occurs $I$ hours later at Run $N+1$.
3. At this point, the token's remaining lifetime is $(T + \epsilon) - I = \epsilon - (I - T) < 0$ hours. The token has already expired!

### The Consequence
If the API (like VK ID v2) does not allow refreshing an already expired token, or invalidates the `refresh_token` upon access token expiration, the cron worker encounters `invalid_grant` or `invalid_token`. The system is forced to mark the authentication as expired (`authExpired: true`) and request manual login.

### The Fix
To ensure zero blind spots, the refresh threshold $T$ **must always be strictly larger** than the cron check interval $I$.
$$T > I$$
For example, if your cron runs every **6 hours** ($I = 6$), set your refresh threshold to at least **10 hours** ($T = 10$). This guarantees that any token expiring before the next run is caught and rotated while it is still fully active and valid.

## VK ID v2 OAuth2 Specifics
- **Token Lifetime:** Typically 24 hours (86400 seconds).
- **Refresh Token Expiration:** Tightly coupled to the session. If not refreshed proactively within the 24-hour window, the refresh token itself is invalidated.
- **Rotation:** VK ID v2 often returns a new `refresh_token` on every refresh request. Your database must atomically overwrite BOTH the `access_token` and the `refresh_token` on every successful rotation.

## Recommended Reconnection Flow
When a token does expire, notify the user immediately but gracefully:
1. **Try Telegram first:** If the user has an active Telegram bot session or campaign settings, send a rich HTML notification with a direct, one-click reconnect link.
2. **Fallback to Email:** If Telegram is unavailable, fetch the user's email via the database (e.g., Directus) and send a clean HTML email.

## Common Pitfalls
1. **Setting $I > T$:** Creates the mathematical blind spot described above. Always keep $T > I$ (with a comfortable buffer of 2-4 hours).
2. **Not caching/rotating refresh tokens:** Some APIs issue a single-use refresh token that changes on every rotation. If you don't update your database with the new `refresh_token` returned from the API, the next refresh attempt will fail.
3. **Double-triggering / Race Conditions:** Multiple worker threads (e.g. background cron + a user action that triggers publishing) might attempt to refresh the same token simultaneously. Always implement a per-campaign/per-token in-memory lock or mutex during the refresh call to prevent race conditions that invalidate the token at the API server.

## Related Reference Files
- [SPA OAuth Redirect & Authentication Debugging Reference](references/spa_oauth_redirect_loops.md) — Playbook for diagnosing silent login redirect loops and static Vite build issues in production.
- [OmniRoute Field Encryption & Decryption Troubleshooting Reference](references/omniroute-credential-decryption.md) — Playbook for diagnosing database migration decryption issues, mismatched STORAGE_ENCRYPTION_KEY, and global npm module resolution paths.

## Verification Checklist
- [ ] Check background cron interval ($I$) and refresh threshold ($T$). Verify $T > I$ is satisfied.
- [ ] Ensure `refresh_token` returned in API response is saved back to storage.
- [ ] Implement in-memory lock map to prevent parallel duplicate refreshes.