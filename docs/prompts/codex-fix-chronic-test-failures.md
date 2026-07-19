# Task D: fix remaining 10 chronic test failures in 7 files (after Task C)

## Context

Working in `G:\Projects\smm-video` (Node.js + TypeScript + Vitest).

This prompt handles the **non-network** chronic test failures. Task C
(separate prompt) must run **first** and fix the 2 network-bound files
(`autonomous-ai-tools.test.ts`, `api_routes_new.test.ts`). By the time
you start, those should be green and the remaining baseline is **7
failures in 6 files**.

If Task C hasn't run, **stop and tell the orchestrator** — running this
without C means you'll re-discover and re-fix the network issues.

---

## Files in scope (after Task C has run)

| File | Failures | Likely cause |
|---|---:|---|
| `server/__tests__/environment-detector.test.ts` | 1 | `detectEnvironment` — probably `NODE_ENV` set in the test runner differs from what the helper expects |
| `server/__tests__/health.test.ts` | 2 | Health endpoint — probably mocks for `n8n` reachability |
| `server/__tests__/logger.test.ts` | 1 | `logger helper methods > debug should log message` — likely `LOG_LEVEL` env or transport mock |
| `server/__tests__/publish-scheduler-routing.test.ts` | 1 (flaky) | `publish-scheduler-routing` — runs `5 failed` on baseline and `1 failed` on HEAD (per the review). Timing/ordering race. **Run the test 3–5 times in a row** to gauge flakiness before fixing |
| `server/__tests__/telegram-collect-comments.test.ts` | 1 | "сохраняет комментарии в post_comment с маппингом from_id→author" — mock or schema drift |
| `server/__tests__/youtube-service.test.ts` | 2 | "should successfully send payload to n8n webhook", "should set isShort to true if content type is clip" — n8n is local HTTP, but the test setup may not have it running |
| `server/__tests__/ai-assistant-service.test.ts` | 2 | "should show campaign options for message with URL and create intent", "should extract campaign name if provided in quotes" — likely depends on `geminiDirect.generateText` (the real one) |

That's 7 in 6 files, total **10 failures** including the 2 n8n
failures in youtube-service. Wait — the baseline is 17 total. After
Task C removes 7, this is 10. The list above sums to 1+2+1+1+1+2+2 = 10.
Correct.

---

## What to do

### General rules

- **No blanket `it.skip`.** If a test cannot be fixed, mark it
  `it.todo('reason here')` or `it.skip` **with a comment** that says:
  - What is broken
  - Why fixing it is out of scope
  - What would unblock the fix (e.g. "needs n8n running on
    localhost:5678", "depends on Gemini key in CI env")

  A `.skip` without a reason is a regression waiting to happen.

- **Mock at the boundary, not the implementation.** Mock the HTTP
  client / external service, not the internal wrapper. The test value
  is in exercising the production code path; only the I/O is replaced.

- **For flaky tests, don't paper over the flakiness with
  `setTimeout(100)`.** Find the real race condition. The `setTimeout`
  fixes will hide the bug and create real bugs later.

### Per-file guidance

#### `environment-detector.test.ts` (1 failure)

The test expects `detectEnvironment()` to return `'development'`
under `ENV=development`. The failure message in the baseline
(`должен определять development при ENV=development`) suggests the
helper reads `process.env.NODE_ENV` or `process.env.ENV`. In a Vitest
run, those are usually inherited from the shell — but the
`vitest.config.ts` may set `NODE_ENV=test`, which shadows them.

Two fixes:
1. **Test-side:** set the env in a `beforeEach` / `vi.stubEnv` and
   restore in `afterEach`.
2. **Production-side:** if the helper should look at multiple env
   names, fix the helper. (Check what `environment-detector.ts`
   actually reads first.)

Prefer (1) — it's the smaller, safer change.

#### `health.test.ts` (2 failures)

Two failures:
- "должен возвращать 200 и status ok когда все сервисы healthy"
- "должен помечать n8n как unreachable когда get возвращает null"

The first probably means the test doesn't mock the n8n / DB / etc.
reachability checks, and they actually call out. Mock the upstream
services to return "healthy" for the first, "null" for the second.

If the test infrastructure is calling the real services, that's a
test-design bug, not a production bug. Mock at the service boundary.

#### `logger.test.ts` (1 failure)

`helper methods > debug should log message`. The test asserts that
calling `log.debug(...)` produces output. If the test's `LOG_LEVEL`
is set to `info` or above, debug is suppressed — and the assertion
fails. Either:
- Set `LOG_LEVEL=debug` in the test (or via `vi.stubEnv`).
- Or have the test call a method whose level the production logger
  doesn't gate (but the helper is the test's subject, so don't change
  the helper).

#### `publish-scheduler-routing.test.ts` (1 failure, FLAKY)

This test is known-flaky. Before fixing:
1. Run it 5 times back-to-back: `for i in 1..5; do npx vitest run
   server/__tests__/publish-scheduler-routing.test.ts; done`
2. If 1-2 of 5 runs fail, it's a real flake. Investigate.
3. If 0-1 of 5 runs fail (i.e. it passes 4-5 times), the failure is
   environmental and may be skipped with a `.todo` and a comment,
   but **only after** confirming the flakiness.

When investigating, common causes:
- `Date.now()` in production, `new Date()` in test — both drift
  between run and assertion.
- A test cleanup that runs after the assertion in some run orders.
- Shared module state leaking between `it()` blocks (e.g. an
  un-mocked module-level variable).

If you can't fix the flake, do **not** add `setTimeout(100)` to
silence it. Either fix the race or add `.todo` with a precise
description.

#### `telegram-collect-comments.test.ts` (1 failure)

"сохраняет комментарии в post_comment с маппингом from_id→author".
Likely the test mocks the Telegram API but the production code path
renamed a field between versions. Read the test, find the
discrepancy, fix the test (or production, if it's a real bug — but
report rather than silently fix).

#### `youtube-service.test.ts` (2 failures)

- "should successfully send payload to n8n webhook" — n8n is a local
  service. The test probably tries to call `http://localhost:5678`
  and times out. Mock `axios.post` (or whatever the service uses) to
  capture the request and return a fake n8n response.
- "should set isShort to true if content type is clip" — pure logic,
  no network. Look for a mock or env variable the test reads.

If you can run a real n8n on localhost, the first test would
genuinely pass; in CI it can't, so mocking is the right call.

#### `ai-assistant-service.test.ts` (2 failures)

These are the "should show campaign options" / "should extract
campaign name in quotes" tests. They likely call `geminiDirect` for
real — same root cause as Task C. Even though Task C was supposed to
mock gemini, the ai-assistant test file probably imports gemini
differently or through a re-export. Check the imports; if the test
imports `geminiDirect` directly, add a `vi.mock` to this file as
well. This is a small additional cost — not a separate "Task E".

### Vitest baseline (REQUIRED REPORT)

Before starting work, run the full suite. This is your chance to
catch a Task C regression or to confirm C actually shipped:

```powershell
npx vitest run 2>&1 | tee vitest-before.txt | Out-Null
```

Expected baseline after Task C: **7 failed files / 10 failed tests**
in the 7 files listed above. If you see more failures, Task C
didn't fully land — stop and report.

After your changes, run again and report:
- Full suite: `Test Files X passed | Y failed (total)` / `Tests N
  passed | M failed (total)`. Goal: **0 failed** by the end.
- For each file you touched: how many tests went from fail → pass.
- Any tests you left as `.skip` or `.todo` with their reasons.
- `git diff --check` clean.

The gold standard at the end: `npx vitest run` exits 0. If you get
to 0 failures, you've earned the right to call this a refactor that
restores the safety net.

---

## Acceptance criteria

1. `npx vitest run` exits 0. Zero failed files, zero failed tests.
2. The 6 files in scope are all green.
3. **No blanket `.skip` is allowed.** Any `.skip` or `.todo` you
   introduce must have a comment with: what's broken, why you didn't
   fix it, and what would unblock the fix.
4. `git diff --check` clean.
5. No production code in `server/services/*` is changed, unless you
   found a genuine bug — in which case you must call it out
   explicitly in your report (don't silently fix it).
6. `publish-scheduler-routing.test.ts` was run ≥ 3 times back-to-back
   to confirm the fix isn't a fluke-coincidence.

---

## DO NOT FIX (conscious trade-offs)

- `getContentPublicationStatus` / `published_at = null` for partial /
  `hasScraperData` skip — these are design choices, not bugs. The
  review document in `docs/prompts/review-follow-ups-2026-07-19.md`
  has the full list.
- Task A and Task B territory. If you find a place where a test
  fails because of a `<pre>` handling or status-string issue, that
  belongs to those tasks — flag it but don't fix.
- The `_archive/docs/` and `docs/SCRAPER_API_INTEGRATION_ISSUES_ROMA.md`
  files.

---

## Out of scope

- Task A, B, C — all must be done first.
- Re-enabling `it.skip` patterns from earlier in the codebase that
  this task didn't add. (If you find one and want to fix it, file
  a separate prompt — don't expand scope here.)
- Production code changes.
- `git push`.

---

## How to verify locally

```powershell
cd G:\Projects\smm-video
# Repeat to catch flakes in the routing test
for ($i=1; $i -le 5; $i++) {
  Write-Host "=== Run $i ==="
  npx vitest run server/__tests__/publish-scheduler-routing.test.ts
}
npx vitest run   # full suite
git diff --stat
git grep -nE "\\.skip\\(|\\.todo\\(" server/__tests__/ | Select-String "codex-d"
```

---

## Commit message

```
test: fix remaining 7 chronic failures, restore green full-suite

- environment-detector: stub env in test, no production change
- health: mock n8n reachability checks
- logger: ensure LOG_LEVEL=debug in test setup
- publish-scheduler-routing: fix race in [specific area],
  verified by 5x back-to-back runs
- telegram-collect-comments: align test with current schema
- youtube-service: mock n8n + fix isShort detection
- ai-assistant-service: mock geminiDirect

Full vitest run exits 0. No blanket .skip; any .skip/.todo carries
a reason in the source.
```
