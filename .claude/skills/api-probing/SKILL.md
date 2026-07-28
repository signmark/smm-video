---
name: api-probing
title: API Endpoint & Key Validation
description: >
  Probing an unknown API gateway, validating whether an API key works, and
  diagnosing which paths are live. Use when checking provider endpoints,
  sanity-checking keys, or iterating quickly over /v1, /v1/models,
  /v1/chat/completions-style paths.
---

# API Endpoint & Key Validation

## Trigger
- User gives an API key + base URL and asks: "does this work?"
- Sanity check before wiring a provider into app config.
- Diagnosing 401 vs 404 vs host-down.

## Approach

1. Pick **one canonical path** first:
   - OpenAI-compatible: `base + '/v1/chat/completions'`
   - Models list: `base + '/v1/models'`
2. If `base + '/v1'` returns 404, that is expected and not a failure — many providers do not expose `/v1` itself.
3. Report the result as:
   - HTTP status code
   - Response body (truncated to the first ~2 KB)
   - Verdict: valid vs invalid key vs path issue vs host down.

## Pitfall: shell quoting with `curl -H "Authorization: Bearer ***` with embedded spaces/tokens can break bash parsing. If `curl` returns an unexpected error or missing output, **do not loop on shell quoting**. Use this script instead:

```python
import urllib.request
url = "<FULL_URL>"
req = urllib.request.Request(url, headers={"Authorization": "<HEADER_VALUE>"})
with urllib.request.urlopen(req, timeout=30) as r:
    print(f"STATUS {r.status}")
    print(r.read(4000).decode("utf-8", errors="replace"))
```

Run via `execute_code`. This bypasses shell expansion completely.

## Output style
State only what matters:
- endpoint tried
- status and body excerpt
- final verdict (valid / invalid / 404 / unreachable)

No verbose disclaimers. No "I cannot confirm" without an actual HTTP response supporting it.
