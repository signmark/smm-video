---
name: Vite build memory limit
description: Vite build falls silently (exit -1, no output) without memory flag — requires NODE_OPTIONS override
---

**Rule:** Always run vite build with `NODE_OPTIONS="--max-old-space-size=1024" npx vite build --mode production`

**Why:** The default Node.js heap is too small for this large React app bundle. Without the flag, the process is OOM-killed before printing any output (silent exit code -1). 1024 MB is sufficient.

**How to apply:** Any time `npx vite build` or `npm run build` is needed on the client bundle, prefix with `NODE_OPTIONS="--max-old-space-size=1024"`.
