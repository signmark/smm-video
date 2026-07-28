# SPA OAuth Redirect & Authentication Debugging Reference

## The Silent Redirect Loop (Symptom Profile)

When integrating OAuth2 (e.g., Google, Github) into a Single Page Application (SPA) backed by a separated FastAPI service, a common and frustrating failure state is the **Silent Redirect Loop**:
1. The user clicks "Login", is redirected to the provider, authenticates successfully, and returns to the backend callback.
2. The backend creates/authenticates the user, issues a JWT, and redirects to the frontend callback page: `https://frontend.com/auth/callback#token=eyJhbG...`
3. The address bar briefly flashes the callback route, but then instantly drops back to the landing page `/` (or `/login`), without showing any error message.

---

## Root Cause Mapping

This loop is almost always caused by a race condition or a validation failure in the frontend route guards:

```
[Google / Provider]
        │
        ▼ (Redirect with Code)
[FastAPI Backend Callback]
        │
        ▼ (302 Redirect with Hash #token)
[SPA /auth/callback]
        │
        ├── 1. Saves token to localStorage
        ├── 2. Calls refresh() -> GET /api/v1/auth/me (to load profile)
        │      └── FAILURE (CORS, mixed content, AdBlock EasyList, wrong API URL)
        │          └── user is set to null
        │
        ▼ (replaceState -> navigate('/dashboard'))
[SPA /dashboard or /today]
        │
        └── useEffect: if (!loading && !user) navigate('/')
            └── Kicks user back to landing page!
```

---

## Diagnostic Step-by-Step

### 1. Check Browser Console & Network Tab (F12)
Look for requests to `/api/v1/auth/me` or `/api/v1/users/me` during the redirect flash:
- **`TypeError: Failed to fetch`**: Indicates a network/SSL or mixed content block.
- **`net::ERR_BLOCKED_BY_CLIENT`**: Indicates browser ad blockers (e.g., uBlock Origin, AdGuard, Brave Shield) are intercepting and blocking the request because the endpoint URL contains `/me`, `/auth/me`, `/metrics`, or other segments flagged in EasyPrivacy/EasyList.
- **`401 Unauthorized`**: Token format/signature is invalid, or backend `JWT_SECRET_KEY` mismatch.
- **No request to `/me` at all**: The JavaScript route-guard in `/auth/callback` threw an exception before the fetch could fire, or `localStorage` was blocked.

### 2. Verify Vite Static Build Environment Variables (VITE_API_URL)
In Vite, environment variables starting with `VITE_` are compiled **statically at build time** into the JS bundle:
- If `VITE_API_URL` is defined in Vercel/Netlify's dashboard but was not present in the environment *during the build command*, Vite falls back to the hardcoded default (often `http://localhost:8000`).
- When running in production (HTTPS), calling an HTTP backend (`http://localhost:8000`) will fail silently due to **Mixed Content security block** or throw a network error.
- **Verification**: Run `curl -s https://your-frontend.vercel.app/assets/index-xxx.js | grep -o -E "http://localhost:8000|your-api.pw"` to see which URL Vite compiled into the production static assets.

### 3. Verify CORS on FastAPI Backend
An OPTIONS preflight request will be sent by the browser before calling `/api/v1/auth/me` with custom authorization headers:
- Run a manual preflight check to confirm origins are allowed:
  ```bash
  curl -v -X OPTIONS \
    -H "Origin: https://your-frontend.vercel.app" \
    -H "Access-Control-Request-Method: GET" \
    -H "Access-Control-Request-Headers: Authorization,Content-Type" \
    https://your-api.pw/api/v1/auth/me
  ```
- Look for `access-control-allow-origin: https://your-frontend.vercel.app` and `access-control-allow-credentials: true` in the response headers.

### 4. Trace the Route Guard `useEffect` Race Condition
Look at the destination route (e.g., `Today.tsx` or `Dashboard.tsx`):
```typescript
const { user, loading } = useAuth();
useEffect(() => {
  if (!loading && !user) {
    navigate('/'); // Kicks out!
  }
}, [user, loading, navigate]);
```
If `/auth/callback` redirects to `/today` **before** the profile loading fetch in `refresh()` resolves (or if the fetch fails and resets `user` to `null`), the user will be instantly ejected back to `/`.

### 5. Check Browser AdBlocker Rules (EasyPrivacy / EasyList)
If you see `ERR_BLOCKED_BY_CLIENT` on your user profile requests:
- **The Issue**: Standard EasyList/EasyPrivacy filters block standard authentication/identity endpoint paths like `/me`, `/auth/me`, `/user/me`, `/metrics`, or `/track/me` because they use simple wildcards or substrings (e.g. `*/me*` or `*/auth/me`) intended to stop identity-tracking scripts.
- **The Pitfall**: This is a silent failure that only happens on clients with ad blockers enabled, making it look like a backend outage or a routing issue to specific users.
- **Verification**: Try disabling the ad blocker. If the request succeeds immediately, you are hitting an EasyList rule.

---

## Defensive Coding Fixes

### 1. Complete authentication BEFORE redirecting
Ensure the profile data is fully fetched and the React context state is updated *before* invoking `navigate('/dashboard')`:
```typescript
// Inside AuthCallbackPage.tsx
try {
  localStorage.setItem('auth_token', token);
  
  // Wait until context is fully refreshed with active user info
  const refreshedUser = await refresh(); 
  
  if (refreshedUser) {
    navigate('/dashboard', { replace: true });
  } else {
    navigate('/auth/error?reason=profile_load_failed', { replace: true });
  }
} catch (err) {
  navigate('/auth/error?reason=auth_failed', { replace: true });
}
```

### 2. Handle loading state in Route Guards
Always check both `loading` and explicit `user` values inside protected pages to avoid flashes of unauthenticated states:
```typescript
if (loading) {
  return <LoadingSpinner />;
}
```

### 3. Avoid /me and /auth in Public Authentication Endpoints (Bypassing AdBlock Rules)
To circumvent aggressive ad blocker heuristics that result in `net::ERR_BLOCKED_BY_CLIENT`:
- **The /auth Trap**: Simply changing `/me` to `/auth/user-profile` or `/auth/session` is often **insufficient**, as aggressive rules in EasyPrivacy/EasyList (like Brave Shield or uBlock Origin) often block anything containing `/auth/` under certain domains or path wildcard structures (e.g., `*auth*` or `*/api/*/auth/*`).
- **Use Standard, Non-Auth Prefixes**: Route your user check to a generic resource path like `/api/v1/users/profile` or `/api/v1/users/profile-details`. Adblockers never block `/users/profile` as it is an essential part of normal web apps.
- **Bypass /me on Subscriptions/Status**: Similarly, avoid `/subscription/me` or `/settings/me`. Use safe aliases like `/subscription/status` or `/settings/details`.

### Real-World Production Case Study: coach.zhdanov.pw
During production deployments of the *AI Daily Coach* SaaS, we encountered silent authentication failures on Brave Shield/uBlock where the preflight `GET https://coach.zhdanov.pw/api/v1/auth/me` threw:
`GET https://coach.zhdanov.pw/api/v1/auth/me net::ERR_BLOCKED_BY_CLIENT`

**Resolution Workflow:**
1. **Multi-Route Backend Decoration**: We kept `/api/v1/auth/me` for legacy compatibility but decorated the same endpoint with a new safe path under the `/api/v1/users` router (prefixing to `/api/v1/users/profile`) to completely avoid the `/auth` path segment.
2. **Client SDK and Context Hot-Fix**: Updated `AuthContext.tsx`, `auth.ts`, and `sdk.ts` to fetch `/api/v1/users/profile` instead of `/api/v1/auth/me`.
3. **No-Cache Redeployment**: Deployed the backend Docker container and triggered a clean Vercel production build to ensure client-side compiled files were updated.
4. **Subscription Bypass**: Similarly, we mapped subscription status checking to `/api/v1/subscription/status` to prevent similar tracking protection blocks.
- **Maintain Backwards Compatibility**: On the backend, keep `/me` for legacy or non-adblocked users, but expose the same logic via a clean route like `/api/v1/users/profile` under your user/profile controller.
- **Update Client SDKs**: Transition all active client code, hooks (such as `useSubscription`), and SDK fetch calls to use the non-blocked, clean endpoints (`/api/v1/users/profile` and `/api/v1/subscription/status`). This completely immunizes your SaaS from EasyList/EasyPrivacy false positives.
