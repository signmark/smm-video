# 🤝 Directus-Compatible Leads Qualification Guide

This guide documents how to create, configure, and integrate an automated leads qualification table inside a production-grade Directus/PostgreSQL stack.

## 1. PostgreSQL Schema definition

Create the following database structure in your PostgreSQL instance (e.g., inside the same DB used by Directus):

```sql
CREATE TABLE IF NOT EXISTS leads_qualification (
    id SERIAL PRIMARY KEY,
    source_platform VARCHAR(50) NOT NULL,
    channel_id VARCHAR(100) NOT NULL,
    post_id VARCHAR(100) NOT NULL,
    comment_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    username VARCHAR(100),
    first_name VARCHAR(100),
    comment_text TEXT NOT NULL,
    qualification_status VARCHAR(50) DEFAULT 'pending',
    qualification_reason TEXT,
    extracted_needs TEXT,
    raw_api_response TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crucial unique index to prevent duplicate ingestion
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_comment_uniq 
ON leads_qualification (source_platform, channel_id, post_id, comment_id);
```

---

## 2. Directus Auto-Discovery & Registration

Directus has a native auto-discovery engine. When you register an existing database table as a collection via the REST API, it automatically imports all columns as fields.

### API Registration Payload (`POST /collections`)
To register the collection programmatically, obtain an admin `access_token` via `/auth/login` and dispatch:

```json
{
  "collection": "leads_qualification",
  "meta": {
    "icon": "handshake",
    "color": "#673AB7",
    "display_template": "{{comment_text}}",
    "show_in_sidebar": true,
    "sort_field": "id"
  },
  "schema": {}
}
```

---

## 3. Creating Default Grid Presets

By default, newly discovered collections do not show custom fields in the grid view. To force the grid to display status, reasons, and comment text by default for all users, update or insert a record in `directus_presets` or use the `/presets` API:

### Preset Configuration Payload (`POST /presets` or `PATCH /presets/{id}`)
```json
{
  "collection": "leads_qualification",
  "layout": "tabular",
  "layout_query": {
    "tabular": {
      "fields": [
        "id",
        "qualification_status",
        "qualification_reason",
        "comment_text",
        "username"
      ],
      "sort": ["-id"]
    }
  }
}
```

---

## 4. Key Implementation Pitfalls

### 4.1. Psycopg2 `%` Wildcard Escaping
When using Python's `psycopg2` to perform database queries or runs, any SQL statement containing native `%` wildcards (like `LIKE '%цена%'`) will crash with an `IndexError: tuple index out of range` error because the driver parses `%` as a template parameter marker.
* **Fix:** Double all percentages inside strings to escape them: `LIKE '%%цена%%'`.

### 4.2. Directus Auth Token Expirations
Instead of relying on static admin tokens (`DIRECTUS_ADMIN_TOKEN`), always use a dynamic login routine that parses credentials from `.env` and exchanges them for temporary session tokens before performing metadata changes.
