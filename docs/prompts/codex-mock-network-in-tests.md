# Task C: mock external network in 2 test files (precedes Task D)

## Context

Working in `G:\Projects\smm-video` (Node.js + TypeScript + Vitest).

Two test files in the chronic-failures list call external services for
real. Total **7 of the 17** baseline failures live here. Both can be
fixed by mocking at the test boundary — the actual production code
behaves correctly; the tests just don't isolate.

| File | Failures | External service |
|---|---:|---|
| `server/__tests__/autonomous-ai-tools.test.ts` | 2 | Gemini image generation + Beget S3 upload |
| `server/__tests__/api_routes_new.test.ts` | 5 | Gemini (`/api/generate`), keywords endpoint, `/api/ai/validate-keys` — all 5s timeouts confirm real network |

**This prompt covers only these 2 files.** Task D handles the
remaining 7 chronic failures (which are not network-bound). The two
tasks must run **sequentially, not in parallel** — C first, then D on
what's left.

---

## What to do

### For `server/__tests__/autonomous-ai-tools.test.ts`

Find where the test imports or uses Gemini generation and Beget S3
upload. Mock at the module boundary using `vi.mock(...)` so no real HTTP
calls happen.

Typical pattern:

```ts
// At the top of the file
vi.mock('../../services/gemini-direct', () => ({
  geminiDirect: {
    generateImage: vi.fn(async () => ({ url: 'https://mock/img.png' })),
    generateText: vi.fn(async () => 'mock-text'),
    validateKeys: vi.fn(async () => ({ valid: true })),
  },
}));

vi.mock('../../services/beget-s3-storage', () => ({
  begetS3: {
    upload: vi.fn(async (_key: string, data: Buffer) => ({
      url: `https://mock-s3/${_key}`,
      key: _key,
    })),
  },
}));
```

Adjust the mock return shape to match what the real services return
(check the service's return type or the test's assertions). The test
assertions should then pass without any network.

If the test relies on a default-imported singleton (e.g.
`import { geminiDirect } from '../../services/gemini-direct'`), the
`vi.mock` factory must export the same name with the same shape.

### For `server/__tests__/api_routes_new.test.ts`

Same idea. The 5 failing tests in this file all show ~5s timeouts —
that's the Vitest default test timeout (or whatever the test sets) and
strongly implies an external HTTP call. Identify which service each
test uses (`gemini`, `validateKeys`, `getKeywords`?) and mock them.

```ts
// Likely suspects to mock — confirm by reading the test
vi.mock('../../services/gemini-direct', () => ({ /* as above */ }));
vi.mock('../../services/keyword-extraction', () => ({ /* mock */ }));
```

The `/api/ai/validate-keys` test probably hits the real `gemini` client
to validate. Mock `geminiDirect.validateKeys` to return a fixed
result.

The `/api/keywords` test probably calls a real keyword-extraction
service. Mock that.

Do **not** mock Express / the router itself — the test's value is
exercising the route handler. Only mock the boundary services.

### Don't change the production code

If you find a test fails because the production code is genuinely
buggy, **stop and report**. Do not fix production code from a test
prompt. File the production-code issue as a separate finding.

### Vitest baseline (REQUIRED REPORT)

Before starting work:

```powershell
npx vitest run 2>&1 | tee vitest-before.txt | Out-Null
```

Expected baseline: 9 failed files / 17 failed tests, with 7 of those
17 in the two files you own. Capture and report.

After your changes, run again and report:
- Full suite: `Test Files X passed | Y failed (total)` / `Tests N
  passed | M failed (total)`.
- For each of your 2 files individually: how many tests went from
  fail → pass.
- Any incidental changes to other files (should be zero).
- Remaining baseline failures (should be 17 - 7 = 10 after this task,
  all of which belong to Task D).

If you can't get the runtime below 1 second per mocked test, you're
probably still hitting the network somewhere — re-check mocks.

---

## Acceptance criteria

1. `npx vitest run server/__tests__/autonomous-ai-tools.test.ts
   server/__tests__/api_routes_new.test.ts` — all green.
2. No test in those 2 files takes more than 2 seconds (proves no real
   network).
3. Full `npx vitest run` shows 10 failed files (was 9, but if you fixed
   the 2 files cleanly, the count of "files with failures" goes from 9
   to 7 — note: the number of files with failures can change as
   files go from "all tests pass" to "all tests pass" or vice versa).
4. The 7 individual test failures in these 2 files are gone.
5. No new `it.skip` introduced. No production code changed.
6. `git diff --check` clean.
7. Other 7 baseline failures (in `environment-detector.test.ts`,
   `health.test.ts`, `logger.test.ts`, `publish-scheduler-routing.test.ts`,
   `telegram-collect-comments.test.ts`, `youtube-service.test.ts`,
   `ai-assistant-service.test.ts`) are **untouched** — Task D's.

---

## DO NOT FIX (conscious trade-offs)

- `getContentPublicationStatus` / `published_at` / `hasScraperData`
  trade-offs (see the global list in `docs/prompts/review-follow-ups-2026-07-19.md`).
- The 7 baseline failures in non-network files. Those are Task D's
  problem, not yours. Don't "fix" them on the way through.

---

## Out of scope

- Any of the other 7 chronic-failures files.
- Task A (telegram-html) and Task B (status unification).
- The `_archive/docs/` files and the untracked `docs/SCRAPER_API_INTEGRATION_ISSUES_ROMA.md`.
- Production code in `server/services/*` (unless you find a genuine
  bug — then stop and report instead of fixing).
- `git push`.

---

## How to verify locally

```powershell
cd G:\Projects\smm-video
npx vitest run server/__tests__/autonomous-ai-tools.test.ts server/__tests__/api_routes_new.test.ts
npx vitest run   # full suite, for the report
git diff --stat
```

---

## Commit message

```
test(autonomous, api_routes): mock external services, no real network

- autonomous-ai-tools.test.ts: mock geminiDirect and begetS3 modules
- api_routes_new.test.ts: mock geminiDirect and keyword extraction
- 7 tests fixed (2 + 5), runtime per test <2s
- No production code changes
```
