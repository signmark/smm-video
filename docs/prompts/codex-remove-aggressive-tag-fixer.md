# Task: Remove `aggressiveTagFixer` (now redundant after `toTelegramHtml`)

## Context

Working in `G:\Projects\smm-video` (Node.js + TypeScript + Express + Directus + Vitest).

Recent commit `6ec4ad4` ("fix(telegram): convert unsupported HTML to Telegram-safe equivalents") introduced a new shared utility `server/utils/telegram-html.ts` with `toTelegramHtml()` that already handles, end-to-end, the same work that the old `aggressiveTagFixer()` was doing in `server/services/social/telegram-service.ts`:

- standardises `<strong>` / `<em>` / `<del>` / `<ins>` → `<b>` / `<i>` / `<s>` / `<u>`
- strips unsupported tags
- normalises `<a href="…">`
- balances the tag stack (closes unclosed, removes stray closers, fixes cross-nesting)
- escapes stray `&` / `<` / `>` outside tags

So `aggressiveTagFixer` is now belt-and-suspenders. It is called in **4 places** in `telegram-service.ts` after `formatTextForTelegram` (which already calls `toTelegramHtml`). It mostly no-ops, but it wastes CPU, adds 150+ lines of dead code, and the inner fallback `return text.replace(/<[^>]*>/g, '')` (around line 889) actually strips Telegram-safe HTML on errors — which we don't want anymore.

## Goal

Delete `aggressiveTagFixer` and its 4 call sites. Replace the safety net with a thin one-line guard: if `toTelegramHtml` throws, fall back to a plain-text strip (current behaviour of `aggressiveTagFixer`'s `catch` block — but only as a last resort, not the primary path).

## Files to change

> **Grep tip:** search for BOTH `aggressiveTagFixer` AND `forceFixedHtml` — the retry-branch call after a Telegram error uses the second name. Easy to miss.

### 1. `server/services/social/telegram-service.ts`

- Remove the **5** calls (not 4) — there's a hidden one in the Telegram-error retry branch:
  - line ~266 (text publish flow): `this.aggressiveTagFixer(formattedText)`
  - line ~328 (publish-with-reply / publish-with-extra flow): `this.aggressiveTagFixer(formattedText)`
  - line ~375 (retry after Telegram error): `const forceFixedHtml = this.aggressiveTagFixer(finalText);` — drop the whole retry branch, the underlying send without parse_mode is enough as a fallback.
  - line ~486 (caption in single-image publish): `this.aggressiveTagFixer(formattedCaption)`
  - line ~566 (caption in group-of-images publish): `this.aggressiveTagFixer(formattedCaption)`
- Remove the public method `aggressiveTagFixer` (lines ~726–890) entirely. Keep nothing.
- Remove or update the surrounding log lines "Текст после агрессивного исправления…" / "Подпись после агрессивного исправления…" — no longer applicable.

### 2. `server/services/social/telegram-service.ts` — guard

- Add a tiny private helper at the top of the class (near the other private helpers, before `formatTextForTelegram`):

  ```ts
  private safeFormatForTelegram(content: string): string {
    try {
      return toTelegramHtml(content);
    } catch (e) {
      log(`[Telegram] safeFormatForTelegram fallback to plain text: ${e}`, 'social-publishing');
      return (content || '').replace(/<[^>]*>/g, '');
    }
  }
  ```

- In `formatTextForTelegram`, replace the `let formattedText = toTelegramHtml(content);` line with `let formattedText = this.safeFormatForTelegram(content);`. Keep everything else in that method (truncate to 4096, log, etc.) as is.
- The 4 call sites that currently call `this.formatTextForTelegram(content)` / `this.formatTextForTelegram(caption)` are unchanged — they now get the safe path automatically.

### 3. `server/services/social-platforms/telegram-service.ts`

- No changes. It already calls `toTelegramHtml` directly via its own `sanitizeText`. Just verify no reference to `aggressiveTagFixer` exists (it doesn't — confirmed).

## Tests

Existing tests already cover the `toTelegramHtml` pipeline end-to-end and must stay green:

- `server/__tests__/telegram-html.test.ts` (17 cases) — must pass unchanged.
- `server/__tests__/telegram-service.test.ts` — must pass; the regression test for `&lt;p&gt;` around line 85 is the key one.

**Add one new test** in `server/__tests__/telegram-service.test.ts` (or a new `safeFormatForTelegram.test.ts` if you prefer) to lock in the contract:

- A publish flow that previously went through `aggressiveTagFixer` must still produce Telegram-safe HTML (no `<p>`, no `<div>`, lists rendered as `• …`, etc.).
- Use the same shape as the existing regression test — mock `axios.post`, call `telegramService.publishPost`, assert on the sent `text`.

If you find `aggressiveTagFixer` or `forceFixedHtml` referenced anywhere else (`grep -rE "aggressiveTagFixer|forceFixedHtml" server/`), remove the call sites there too.

## Acceptance criteria

1. `git grep -E "aggressiveTagFixer|forceFixedHtml" server/` returns nothing.
2. `npx vitest run server/__tests__/telegram-html.test.ts server/__tests__/telegram-service.test.ts` → all green.
3. The 4 send paths (text-only, text-with-reply, single-image caption, group-image caption) produce the same final string as before for the existing test fixtures (no behavioural regression in the happy path).
4. A simulated throw inside `toTelegramHtml` (e.g. `vi.mock('../../utils/telegram-html', () => ({ toTelegramHtml: () => { throw new Error('boom'); } }))`) falls back to plain text without crashing the publish.
5. The file `telegram-service.ts` shrinks by ~170 lines net.

## Out of scope

Do **not** touch:

- `server/utils/telegram-html.ts` (already correct).
- `server/services/social-platforms/telegram-service.ts` (already correct).
- The untracked docs in `_archive/docs/` and `docs/SCRAPER_API_INTEGRATION_ISSUES_ROMA.md`.
- The 4 un-pushed commits in the working branch (don't `git push` — owner will push).

## How to verify locally

```powershell
cd G:\Projects\smm-video
npx vitest run server/__tests__/telegram-html.test.ts server/__tests__/telegram-service.test.ts
git diff --stat
git grep -E "aggressiveTagFixer|forceFixedHtml" server/   # should be empty
```

## Commit message

```
refactor(telegram): drop redundant aggressiveTagFixer

toTelegramHtml already standardises, strips, balances, and escapes.
The 4 post-format calls and the 150-line method itself are now
dead code that just adds CPU. Replaced with a 1-line safeFormatForTelegram
guard (try → toTelegramHtml, catch → strip tags).
```
