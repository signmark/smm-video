# SaaS Farm Notion Layout & API Workarounds

This reference documents the structure of the SaaS Farm workspace in Notion and the specific API workarounds required for the custom Notion proxy integration.

## 1. Workspace Structural Layout

All pages are nested under a single parent page representing the SaaS Farm itself:

- **Parent Page (SaaS Farm Hub):** `29cb5834-5579-4746-b347-651ce3982dac`
  - **AI Scouting Network:** `369d556d-e088-814f-b1bb-cf00822633d6` (Scouting sources & configuration)
  - **AI Scout Insights:** `369d556d-e088-814c-b8b5-caee0f9cf381` (Feed digest repository)
    - **Breakfast with Igor Ryabenky (Miami 2026):** `369d556d-e088-8139-a740-eede02c0cdd7` (Venture & SaaS Insights)
  - **Гермес: Текущие задачи и статусы:** `369d556d-e088-818c-85dec-0038eb5a49f` (Task boards and roadmaps)
  - **Гермес: Саморефлексия и Прокачка:** `369d556d-e088-819a-a70a-dcb1015ad645` (System alignment & capability review)
  - **Гермес: Идеи для первых проектов:** `369d556d-e088-8185-90a4-e3fc557de91b` (Venture ideas & MVP stack specs)

## 2. API Interaction Quirks & Workarounds

### A. Custom Markdown Patch Endpoint
The standard Notion API does not support a direct raw Markdown `PATCH` request. The custom proxy used in this workspace implements an endpoint at `PATCH /v1/pages/{page_id}/markdown`.

**Error Pattern:**
Sending a payload like `{"markdown": "# Content"}` will return an HTTP 400 Bad Request error.

**Working Solution:**
The payload must be formatted with the `replace_content` wrapper:
```json
{
  "type": "replace_content",
  "replace_content": {
    "new_str": "# Complete Markdown Page Content\n\n- Bullet points"
  }
}
```

### B. Accessing the Parent-Child hierarchy via Python
When creating child pages or updating contents under the parent page, construct Python `urllib.request` requests to interact with the API key loaded securely from the local `.env` file (`/home/signmark/.hermes/.env`):

```python
import urllib.request
import json

# Fetch credentials securely from /home/signmark/.hermes/.env
api_key = "[REDACTED]"
# Use parent_id to nest new pages
parent_id = "29cb5834-5579-4746-b347-651ce3982dac"
```
