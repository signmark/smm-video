---
name: Image-gen usage storage
description: Where monthly AI image-generation usage counters live and how they are enforced
---

Monthly AI image-generation usage is stored in a JSON field `image_gen_usage` on the
Directus `directus_users` record, shape `{ "month": "YYYY-MM", "count": N }` — NOT in a
separate collection and NOT in a local JSON file anymore.

**Why:** the old local-file tracker lost all counts on container rebuild (no/forgotten
volume). A field on the user was chosen over a dedicated collection because the request
flow already reads the user record (plan, expire_date), so usage lives next to it with no
join. The field was created on BOTH Directus instances (dev + prod) — any new env needs
the same custom field added or counting silently fails-open.

**How to apply:** the tracker (`getUsage`/`incrementUsage`/`canGenerate`) is async and
reads/writes via the Directus admin token. Limits live in two places that must stay in
sync: trial=10 / basic=30 are hard-coded in the image routes, while `plan-limits.ts`
(used only for campaign count enforcement) has its own copy.

**Known trade-offs (intentionally not fixed, pre-existing):**
- read-then-write is non-atomic → concurrent generations from one user can lose an
  increment (minor at this scale; Directus REST has no atomic increment).
- read AND write failures fail-open (allow generation) — matches old behavior; an outage
  means unlimited generation rather than blocking paying users.
- `getUserPlanInfo` in the fal-ai image route decodes the JWT payload without verifying
  the signature — identity could be spoofed for limit attribution. Broader auth concern,
  out of scope of the storage migration.
