# Architecture Findings — Auth & Feature Flags

_Collected across sessions. Key pain points for future refactoring._

## Auth Token Confusion

The project has **three independent auth mechanisms** that overlap:

| Source | Where used | What it returns |
|--------|-----------|-----------------|
| `localStorage('auth_token')` — Directus JWT | `useAuthStore`, API calls | `id, role, app_access, admin_access` — **NO email** |
| `/api/auth/me` — decodes JWT server-side | `useAuth()` hook (React Query) | `user: { id, email, role, isAdmin }` — email always `unknown@email.com` |
| `/api/user/profile` — Directus `/users/{id}` via admin token | Topbar, profile page | `email, first_name, last_name, plan` — **real email** |

**Problem**: Developers expect email from JWT or `/api/auth/me`, but only `/api/user/profile` has it. Every email-based feature (feature flags, admin checks) has hit this trap.

**Fix for future**: Either (a) add email to Directus JWT config, or (b) unify `/api/auth/me` to fetch email from Directus like `/api/user/profile` does, or (c) always use `/api/user/profile` for email.

## Feature Flag Pattern

Current pattern in `campaigns/[id].tsx`:
```tsx
const { data: userProfile } = useQuery<{ email: string }>({
  queryKey: ['/api/user/profile', user?.id || 'me'],
  enabled: !!user?.id,
});
const isStyleFeatureEnabled = userProfile?.email === 'signmark@gmail.com';
```

**Pain points**:
- Requires `useAuth()` to get `user?.id` first
- Extra API call on every campaign page load
- No backend enforcement — client-side only
- Email hardcoded in source code

**Better pattern**: Backend middleware or Directus field-based feature flags.

## Duplicate `disabled` Attributes

`content/index.tsx` had two `disabled` props on the same `<Button>` — esbuild treats this as a hard error (not warning). The simpler one (`publishState === 'publishing'`) was left from an earlier edit; the comprehensive one covered it plus more conditions.

**Lesson**: When merging conditional logic, always check for existing attributes on the same element.

## setState During Render

Calling `setX()` inside an IIFE or inline expression during React render causes error #301. Values computed during render must be plain variables, not state setters.

## Files Involved

- `client/src/pages/campaigns/[id].tsx` — style feature flag, campaign settings
- `client/src/components/AppShell/Topbar.tsx` — email display, uses `/api/user/profile`
- `client/src/hooks/use-auth.tsx` — `useAuth()` hook, queries `/api/auth/me`
- `server/api/auth-routes.ts` — `/api/auth/me` endpoint
- `server/routes/user.ts` — `/api/user/profile` endpoint (the real email source)
- `client/src/pages/content/index.tsx` — publish button with duplicate disabled
