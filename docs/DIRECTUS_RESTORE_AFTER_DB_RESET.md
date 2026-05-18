# Restore Directus Collections After Database Reset

After resetting the database and reconnecting Directus to a clean DB, apply the schema so the app has Campaigns, Content, and other collections.

## What We Have in the Repo

| File | Purpose |
|------|--------|
| **`correct_directus_schema.sql`** | Full SQL schema: creates all SMM tables with Directus-style columns (user_campaigns, campaign_content, campaign_content_sources, campaign_keywords, campaign_trend_topics, global_api_keys, business_questionnaire, post_comment, source_posts, user_api_keys). Use this for a **clean** DB. |
| **`create_directus_schema.sql`** | Alternative schema; references `campaigns(id)` but creates `user_campaigns` — **inconsistent**. Prefer `correct_directus_schema.sql`. |
| **`scripts/directus/apply_schema_after_reset.sql`** | Patch: adds `additional_images` and `published_platforms` to `campaign_content` (required by the app). Run **after** the main schema. |
| **`create_directus_collections_new.js`** | Creates collections via Directus **REST API** (login + `/collections`, `/fields`). Use only if you prefer API over raw SQL. |
| **`restore_full_schema.sh`** | Restores from **export files** (`directus_schema_export.sql`, etc.). Not for a clean DB without those dumps. |

## Recommended: SQL Schema (Clean DB)

1. **Ensure Directus is using the reset database** (connection string points to the new/empty DB).

2. **Apply main schema** (creates tables; Directus will pick them up on next load):
   ```bash
   # If using Docker Postgres:
   docker exec -i $(docker ps -q -f name=postgres) psql -U postgres -d directus < correct_directus_schema.sql

   # Or with local psql:
   psql -U postgres -d directus -f correct_directus_schema.sql
   ```
   Replace `directus` with your actual DB name if different.

3. **Apply patch for campaign_content** (adds columns used by the app):
   ```bash
   docker exec -i $(docker ps -q -f name=postgres) psql -U postgres -d directus < scripts/directus/apply_schema_after_reset.sql
   # or
   psql -U postgres -d directus -f scripts/directus/apply_schema_after_reset.sql
   ```

4. **Restart Directus** so it rescans the DB and registers the new tables as collections (and fills `directus_collections` / `directus_fields` if needed).

5. **Optional: seed global API keys**  
   The schema file inserts placeholder rows into `global_api_keys`. Replace placeholders with real keys in Directus Admin or via SQL.

## Collections Created (correct_directus_schema.sql)

- **user_campaigns** — campaigns (app uses `/items/user_campaigns`)
- **campaign_content** — content items (app uses `/items/campaign_content`)
- **campaign_content_sources** — content sources
- **campaign_keywords** — keywords per campaign
- **campaign_trend_topics** — trend topics
- **global_api_keys** — API keys for AI/services
- **business_questionnaire** — business questionnaires
- **post_comment**, **source_posts**, **user_api_keys** — supporting tables

Plus FKs from campaign tables to `user_campaigns(id)` and indexes.

## Alternative: API-Based (create_directus_collections_new.js)

If you prefer not to run SQL:

1. Start Directus with a clean DB and log in as admin.
2. Set env: `DIRECTUS_URL`, `DIRECTUS_ADMIN_EMAIL`, `DIRECTUS_ADMIN_PASSWORD`.
3. Run:
   ```bash
   node create_directus_collections_new.js
   ```
   This creates only a subset of collections (user_campaigns, campaign_content, global_api_keys, business_questionnaires). For full parity with the app, use the SQL path above.

## After Restore

- Create at least one admin user in Directus if the DB was fully empty.
- Create a static token (Directus Admin → Settings → Access Tokens) and set `DIRECTUS_TOKEN` / `DIRECTUS_STATIC_TOKEN` in the app env.
- Re-run any role/permission scripts you use (e.g. `create_required_roles.js`) if your app depends on specific Directus roles.
