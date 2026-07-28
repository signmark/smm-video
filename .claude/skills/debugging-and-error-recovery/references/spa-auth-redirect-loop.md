# SPA Auth Redirect Loop Debugging

## Symptom
User logs in successfully (OAuth callback completes, token stored), but the app doesn't redirect to the protected page — stays on landing/login or loops back.

## Common Root Cause
`VITE_API_URL` (or equivalent) not set in deployment environment → API calls fall back to `http://localhost:8000` → fail → user context remains `null` → protected routes redirect back to `/`.

## Debugging Path

### 1. Trace the auth flow through code (NOT the network tab first)
Follow the chain in order:

```
Entry (Index.tsx / App.tsx)
  → AuthProvider (AuthContext.tsx) — checkAuth(), loading state
  → Login trigger — redirect to OAuth provider
  → AuthCallbackPage — parse URL fragment/query, store token, call refresh()
  → Protected page (Today.tsx / Dashboard) — checks user, redirects if null
```

### 2. Verify env vars
```bash
# In Vite SPA:
console.log(import.meta.env.VITE_API_URL)  // Check what the built bundle uses

# In Vercel:
# Dashboard → Project → Settings → Environment Variables
# Verify VITE_API_URL is set and matches the backend URL
```

### 3. Common Vite SPA pitfalls
- `import.meta.env.VITE_*` vars are **baked at build time** — changing them requires redeploy
- Fallback chains like `import.meta.env.VITE_API_URL || 'http://localhost:8000'` hide the real problem in production
- Runtime config via `fetch('/api/config')` adds complexity — ensure the endpoint exists on the deployment platform

### 4. Check the protected route guard
```tsx
// Typical pattern that causes loops:
useEffect(() => {
  if (!authLoading && !user) {
    navigate('/');  // ← Kicks user back to landing
  }
}, [user, authLoading, navigate]);
```
If `user` never populates (API unreachable), this creates an infinite redirect.

## Verify Env Var Is Baked Into Production Bundle

`VITE_*` vars are baked at build time. After redeploy, verify they're in the JS:

```bash
# Check the built bundle for the expected backend URL
curl -s https://your-frontend.vercel.app/assets/index-*.js | grep -oP 'coach\.zhdanov|localhost:8000' | sort -u

# "coach.zhdanov" appears → VITE_API_URL is baked in correctly
# "localhost:8000" still appears → fallback path is active, env var not set
```

Also check Vercel cache headers to confirm fresh deploy is serving:
```bash
curl -sI https://your-frontend.vercel.app/ | grep -iE 'x-vercel-cache|age'
# x-vercel-cache: HIT → serving, check age
# x-vercel-cache: MISS → new deploy just went live
```

## Fix: VITE_API_URL (Frontend → Backend)

Set the env var on the deployment platform. For Vercel:

### Dashboard (simplest)
Settings → Environment Variables → add `VITE_API_URL=https://your-backend.domain`
Auto-triggers redeploy.

### Via API (when CLI isn't authenticated or --token fails)

**If `vercel --token` doesn't work** (certain CLI versions ignore the flag):
```bash
# Write auth token directly to Vercel's auth.json
VERCEL_AUTH="$HOME/.hermes/home/.local/share/com.vercel.cli/auth.json"
echo '{"token":"your_vercel_token"}' > "$VERCEL_AUTH"
vercel project ls  # Verify auth works
```

**If the env var doesn't exist yet:**
```bash
curl -s -X POST \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"VITE_API_URL","value":"https://your-backend.domain","target":["production"],"type":"sensitive"}' \
  "https://api.vercel.com/v9/projects/<project-name>/env"
```

**If the env var ALREADY exists (even with empty value):**
```bash
# Find the env ID first
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/<project-name>/env"

# PATCH to update the value
curl -s -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "https://your-backend.domain", "target": ["production"]}' \
  "https://api.vercel.com/v9/projects/<project-name>/env/<env-id>"
```

**Trigger redeploy** (API PATCH doesn't auto-redeploy):
```bash
# From linked project directory:
cd /path/to/frontend && vercel deploy --prod

# Or from any auth'd machine (links current dir):
vercel link --project <project-name> --yes && vercel deploy --prod
```

**⚠️ Key gotchas:**
- `vercel env add` errors if the var already exists — even with empty value
- API PATCH returns `"value":""` for sensitive-typed vars — check `updatedAt` changed, not the value
- Env var changes via API do NOT auto-redeploy — always trigger a deploy after
- `VITE_*` vars are baked at build time, so config-only changes require full rebuild
- The env value appears as empty string in API responses for `sensitive` type vars; the `updatedAt` timestamp confirming the change is the real indicator

## Adblock Interference (ERR_BLOCKED_BY_CLIENT)

### Symptom
Browser console shows `net::ERR_BLOCKED_BY_CLIENT` for API requests. Token is stored, `refresh()` called, but the fetch to `/api/v1/users/profile` never reaches the server. The user lands on the protected page but immediately gets redirected back to login.

### Why It Happens
Adblockers (uBlock Origin, AdBlock, EasyList filters) block common API paths like `/users/profile`, `/api/v1/users/*` — they match tracking/advertising URL patterns.

### Diagnosis
- Network tab shows requests with **blocked** status and `net::ERR_BLOCKED_BY_CLIENT`
- This is NOT a CORS or server error — the request never leaves the browser
- Note: may NOT appear in Console tab; check Network tab for a complete picture

### Fix: Same-Origin API Requests via Vercel Rewrites

The cleanest fix bypasses adblock entirely by making API calls relative to the frontend domain, then proxying via Vercel rewrites.

**Step 1: Add rewrite in `vercel.json`**
```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://your-backend.domain/api/:path*" },
    { "source": "/((?!assets|static|blog|sitemap.xml|robots.txt).*)", "destination": "/index.html" }
  ]
}
```

**Step 2: Change frontend to use relative paths**
```tsx
// Before (adblock-targeted):
const response = await fetch(`${apiUrl}/api/v1/users/profile`, { ... });

// After (same-origin, proxied via Vercel):
const response = await fetch(`/api/v1/users/profile`, { ... });
```

This removes the external domain from API calls. All requests go to the same origin, Vercel proxies to the backend. No VITE_API_URL env var needed.

**Step 3: Deploy and verify**
```bash
vercel deploy --prod
# Verify no external domains in built JS:
curl -s https://your-app.vercel.app/assets/index-*.js | grep -oP 'localhost:8000|your-backend\.domain'
# Should return empty — all API calls are now relative
```

### Why This Is Better
- No VITE_API_URL env var to configure in Vercel
- No CORS issues (same-origin requests don't need CORS)
- Matches Vite's dev proxy pattern (`vite.config.ts` already proxies `/api` in dev mode)
- Adblockers can't distinguish API paths from static assets

### Alternative: Rename API paths
If rewrites aren't an option, avoid `/user`, `/profile`, `/track`, `/analytics` in URL paths.

## Fix: FRONTEND_URL (Backend → Frontend Redirect After OAuth)

Even when `VITE_API_URL` is correct, the OAuth flow has a **second** redirect that can fail independently.

### The dual-env-var pattern

```
User clicks login
  → Frontend redirects to backend at VITE_API_URL/api/v1/oauth/google/login
  → Backend builds redirect_uri: {backend_url}/api/v1/oauth/google/callback
  → User authenticates with Google
  → Google redirects to redirect_uri
  → Backend handles callback, issues JWT
  → Backend redirects browser to {FRONTEND_URL}/auth/callback#token=...
  → Frontend parses token, calls refresh(), navigates to /today
```

**Two env vars must be right:**
| Env var | Where | Controls |
|---------|-------|----------|
| `VITE_API_URL` | Frontend (Vercel/Vite) | Where frontend makes API calls |
| `FRONTEND_URL` | Backend (.env / server env) | Where backend redirects browser after OAuth |

### Common failure: FRONTEND_URL = localhost

In `.env` files committed to repos, `FRONTEND_URL` defaults to `http://localhost:3000`. On the production server, the Docker container loads this same `.env`:
```yaml
# docker-compose.yml
services:
  coach-backend:
    env_file: .env  # ← loads FRONTEND_URL=http://localhost:3000
```

**Result:** After Google OAuth, the backend redirects the user's browser to `http://localhost:3000/auth/callback#token=...` which doesn't resolve on their machine.

**Fix:** Override in server's `.env` or Docker environment:
```
FRONTEND_URL=https://your-frontend.vercel.app
```

### NGROK_URL overrides redirect_uri — critical OAuth gotcha

The backend's `get_dynamic_backend_url()` function checks `NGROK_URL` env var **first** before using request headers:

```python
def get_dynamic_backend_url(request: Request) -> str:
    ngrok_url = os.getenv("NGROK_URL", "").strip()
    if ngrok_url:
        return ngrok_url  # ← Overrides actual domain!
    # ...fall through to host headers
```

This means: if `NGROK_URL` is set in `.env`, the OAuth `redirect_uri` will be `{NGROK_URL}/api/v1/oauth/google/callback` instead of `https://your-domain/api/v1/...`. If that ngrok tunnel is dead or the URL changed, Google's callback will fail with `redirect_uri_mismatch` or 404.

**Fix:** Remove or comment out `NGROK_URL` when deploying behind a real domain. Only use it for local dev with ngrok tunneling.
