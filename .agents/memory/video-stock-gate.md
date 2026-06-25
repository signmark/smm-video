---
name: Video stock gate polling contract
description: video-app — coupling between status='script_ready' and script.stockPrechecked that controls frontend poll-stop
---

# Stock-gate polling contract

Frontend `VideoDetail.tsx` stops its 3s poll only when status is `done`/`error`
**or** (`script_ready` **and** `script.stockPrechecked === true`).

**Rule:** every backend path that releases the project to `script_ready` MUST also
write `script.stockPrechecked = true` in the same `updateProject` call.

**Why:** if a path sets `script_ready` without the marker (e.g. the
`runStockPrecheck(...).catch` fallback, or any early release), the UI keeps
polling forever — it never sees the stop condition. This bit us when only
`status` was set in the failure fallback.

**How to apply:**
- Happy path: `runStockPrecheck` final update sets both.
- Precheck failure (`.catch` in `runScriptOnly`): set both (use the in-scope
  `script` var spread + `stockPrechecked: true`).
- A release path with no script available cannot satisfy the contract → set
  `status='error'` instead of faking `script_ready`.

Flow: `runScriptOnly` → `searching_stock` (gate screen holds user) →
`runStockPrecheck` scans all stock sources per scene → `script_ready` (script
review + per-scene AI/stock choice opens).

Stock sources are Pexels (primary) → Pixabay (fallback, activates only when
`PIXABAY_API_KEY` present in Directus alias `pixabay`) → AI generation.
