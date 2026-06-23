---
name: Directus schema drift & silent field drop
description: Dev vs prod Directus collections can differ; Directus silently ignores unknown fields on write
---

# Directus drops unknown fields silently on write

When writing an item to a Directus collection, **fields that don't exist in that collection's schema are silently ignored** — POST/PATCH return HTTP 200 with the field simply absent from the stored row. No error is raised. So a value that "won't persist" despite correct client code usually means the **field is missing from the collection** (or the token's role lacks field-level write permission), not a client bug.

**Why:** video-app `script_mode` (viral mode flag) never persisted on dev. Root cause: the `script_mode` field existed on prod Directus (`directus.nplanner.ru`) but was **missing entirely** from the dev Directus (`directus.roboflow.space`) `video_projects` collection. Writes were accepted and dropped. By contrast `subtitle_style` persisted because it existed on both.

**How to apply:**
- If a Directus field "won't save," first list the collection fields (`GET /fields/<collection>` with a full admin **login** token — the static admin token is permission-limited on `/fields/*` endpoints and returns 401/403) and confirm the field exists on *that* environment.
- Dev and prod Directus schemas drift. After adding a field on prod, mirror it on dev (create via `POST /fields/<collection>` using the prod field's `type`/`schema`/`meta`).
- Directus may split create vs update field permissions, so some fields must be re-PATCHed right after create (video-app `createProject` re-PATCHes `subtitle_style`, `animation_model`, `script_mode` after the initial POST).
- Full admin access to schema endpoints needs an email/password **login** token, not the static `DIRECTUS_ADMIN_TOKEN`.
