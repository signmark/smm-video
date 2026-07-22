# Follow-up: Kimi AuthGuard Fix — 2026-07-22

## Commit: `990ee7e13` — fix(auth): keep children mounted during background session re-validation

### What it fixes
**Before:** Every background session re-validation (token refresh, storage events, location change) called `setIsSessionChecked(false)`, which unmounted children → page state lost (accordions open, search results, form drafts, etc.)

**After:** `useRef(false)` flag `hasCompletedInitialCheck` — after first successful session check, subsequent re-validations run silently without unmounting children.

### Verification (Playwright)
- Smoke test: 30 checks, 0 errors
- AuthGuard test: URL preserved, content cards preserved after 10s wait (during background refresh)
- **Result: AuthGuard fix working correctly**

### For other agents
- File: `client/src/components/AuthGuard.tsx`
- Pattern: `useRef` flag to prevent re-mount on background state checks
- Impact: Fixes UX issue where page content would flash/disappear during token refresh
