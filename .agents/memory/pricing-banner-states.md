---
name: Pricing page banner states
description: How trial/paid/expired banner exclusivity must be derived on the pricing page
---

# Pricing banner states (client/src/pages/pricing.tsx)

Banner visibility (guest / active trial / active paid / expired) must derive from a
SINGLE canonical expiry check, not computed in two places.

**Rule:** compute `isExpired` once from `expire_date` (`getTime() <= Date.now()`),
then derive `effectivePlan = isExpired ? 'free' : userPlan` and
`hasActiveSubscription`. Keep the raw server plan in `userPlan` (used only for the
expired-banner wording: trial vs paid). All banner/visibility conditions route
through `effectivePlan` / `hasActiveSubscription`.

**Why:** a previous bug showed two contradictory banners — the dashboard said the
trial had ended while pricing showed a green "subscription active" banner. Root
cause was divergent expiry logic: the fetch handler set the plan to 'free' using
`expireDate < now`, while render classified expiry via `daysLeft <= 0` (Math.ceil).
At boundary timestamps these disagreed, allowing overlap. Also the green banner only
excluded `'trial'`, so an expired ('free') user wrongly matched it.

**How to apply:** never reintroduce a second expiry comparison for banner logic.
`daysLeft` / `hasActivePeriod` are for the "remaining days" subtext only, never for
expiry classification.
