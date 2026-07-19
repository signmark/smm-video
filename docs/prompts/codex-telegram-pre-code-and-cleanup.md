# Task A: `toTelegramHtml` — preserve `<pre>`/`<code>` + hex entities + small cleanups

## Context

Working in `G:\Projects\smm-video` (Node.js + TypeScript + Express + Vitest).

Two related issues were found in code review:

1. **`<pre>` / `<code>` content with escaped HTML is destroyed.** The pipeline
   decodes HTML entities first (`decodeHtmlEntities`), so `&lt;div&gt;` inside
   `<pre>` is resurrected into real `<div>`, which is then stripped by
   `convertMarkup`. Confirmed reproduction:
   ```
   toTelegramHtml('<pre>&lt;div&gt;hi&lt;/div&gt;</pre>')
   → '<pre>hi\n</pre>'   // expected: '<pre>&lt;div&gt;hi&lt;/div&gt;</pre>'
   ```
   `<code>` happens to survive because `convertMarkup` does not touch
   `<code>` content, but the principle is the same — the decode-first step
   treats escaped markup as markup.

2. **Hex HTML entities are not decoded.** `&#x27;` passes through, then the
   trailing `&` is escaped to `&amp;` by `escapeTextOutsideTags`, producing
   `it&amp;#x27;s` instead of `it's`. Confirmed reproduction:
   ```
   toTelegramHtml('it&#x27;s') → 'it&amp;#x27;s'
   ```

Plus three small cleanups in the same area.

This prompt covers the **`telegram-html.ts` file plus `telegram-service.ts`
post-processing** — keep them together, as requested. Do **not** touch status
strings in `publish-scheduler.ts` / `storage.ts` / `directus-storage-adapter.ts`
(Task B), network-calling tests in `autonomous-ai-tools.test.ts` /
`api_routes_new.test.ts` (Task C), or any other chronic test failures (Task D).

---

## What to do

### 1. Preserve `<pre>` / `<code>` content in `server/utils/telegram-html.ts`

After `decodeHtmlEntities` and before `markdownToTelegramHtml` /
`convertMarkup`, lift the contents of `<pre>…</pre>` and `<code>…</code>` into
unique placeholders, run the rest of the pipeline, then restore with proper
escaping.

```ts
// New helper near the top of the file
const PRE_PLACEHOLDER_PREFIX = '\u0000PRE_';
const CODE_PLACEHOLDER_PREFIX = '\u0000CODE_';

function liftPreservedTags(input: string): { text: string; restore: Array<{ token: string; body: string }> } {
  const restore: Array<{ token: string; body: string }> = [];
  let i = 0;
  const text = input
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, body: string) => {
      const token = `${PRE_PLACEHOLDER_PREFIX}${i++}\u0000`;
      restore.push({ token, body });
      return token;
    })
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, body: string) => {
      const token = `${CODE_PLACEHOLDER_PREFIX}${i++}\u0000`;
      restore.push({ token, body });
      return token;
    });
  return { text, restore };
}

function restorePreservedTags(output: string, restore: Array<{ token: string; body: string }>): string {
  let result = output;
  for (const { token, body } of restore) {
    // Escape &, <, > inside the lifted body so Telegram's HTML parser sees literal text
    const safe = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Token is a placeholder: <pre>TOKEN</pre> or <code>TOKEN</code>
    // The original tag name is unknown post-pipeline — re-derive from prefix
    const tag = token.startsWith(PRE_PLACEHOLDER_PREFIX) ? 'pre' : 'code';
    result = result.replace(token, `${tag}>${safe}</${tag}>`);
  }
  return result;
}
```

In `toTelegramHtml`, insert the lift right after `decodeHtmlEntities`, the
restore right after `balanceTags` (so it sits between balancing and the
post-balance escape pass — the body is pre-escaped, so
`escapeTextOutsideTags` will not double-escape it because it's now inside
`<pre>` / `<code>` tags, which `escapeTextOutsideTags` treats as tag zones).

> The placeholder uses NUL chars (`\u0000`) so `stripDisallowedTags` (which
> strips any non-allow-listed tag) cannot accidentally eat it. After the
> pipeline, the token is replaced with the original tag content.

### 2. Add hex entity support to `decodeHtmlEntities`

Inside the `decode` loop, add a `&#x...;` branch next to the decimal branch:

```ts
.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
  const cp = parseInt(hex, 16);
  return Number.isSafeInteger(cp) && cp > 0 && cp <= 0x10ffff
    ? String.fromCodePoint(cp)
    : _;
})
```

Place it before the `&amp;` line so `&amp;#x27;` decodes correctly on
multiple passes.

### 3. Remove trailing newline inside `<pre>`

In `cleanupWhitespace`, add a final pass that strips a single trailing `\n`
inside `<pre>…</pre>` blocks. Or do it locally in `restorePreservedTags`
before the escape. Pick the one that is easier to test.

### 4. Cleanup: drop duplicate post-processing in `server/services/social/telegram-service.ts`

`formatTextForTelegram` (around lines 63–66) currently does, **after**
`safeFormatForTelegram` (which is `toTelegramHtml`):

```ts
formattedText = formattedText.replace(/\n{3,}/g, '\n\n');
formattedText = formattedText
  .replace(/\u200B/g, '')
  .replace(/\u200C/g, '')
  .replace(/\u200D/g, '')
  .replace(/\uFEFF/g, '');
```

Both are already done by `toTelegramHtml`'s `cleanupWhitespace` step. Delete
both blocks. Keep the truncation to 4096 and the long-words warning — those
are useful.

### 5. Cleanup: escape the plain-text fallback in `safeFormatForTelegram`

```ts
// Before
return (content || '').replace(/<[^>]*>/g, '');

// After
return (content || '')
  .replace(/<[^>]*>/g, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');
```

(Plus the `content || ''` guard stays.)

### 6. Cleanup: `dropEmptyTags` should also clean empty `<a>`

In `server/utils/telegram-html.ts`, extend the regex from
`/<(b|i|u|s|code|pre|blockquote|tg-spoiler)>\s*<\/\1>/gi` to include `a` —
or add a separate second pass for `<a href="…"></a>`. Low priority, but
called out in the review.

---

## Tests

### New cases in `server/__tests__/telegram-html.test.ts`

```ts
describe('preserved tags (Task A)', () => {
  it('<pre> with escaped inner HTML is preserved verbatim', () => {
    const out = toTelegramHtml('<pre>&lt;div&gt;hi&lt;/div&gt;</pre>');
    expect(out).toBe('<pre>&lt;div&gt;hi&lt;/div&gt;</pre>');
  });
  it('<code> with escaped comparison stays escaped', () => {
    const out = toTelegramHtml('<code>if (a &lt; b)</code>');
    expect(out).toBe('<code>if (a &lt; b)</code>');
  });
  it('hex entity &#x27; decodes to apostrophe', () => {
    expect(toTelegramHtml('it&#x27;s')).toBe("it's");
  });
  it('double-encoded &amp;#x27; decodes to apostrophe in two passes', () => {
    expect(toTelegramHtml('it&amp;#x27;s')).toBe("it's");
  });
  it('<pre> content is not double-escaped by escapeTextOutsideTags', () => {
    const out = toTelegramHtml('<pre>5 &lt; 10</pre>');
    expect(out).toBe('<pre>5 &lt; 10</pre>');
    expect(out).not.toContain('&amp;lt;');
  });
});
```

### Existing tests must stay green

- `telegram-html.test.ts` — currently 20 tests. After your changes, the
  total should be 20 + new cases. None of the existing cases should
  regress; if one does, the change is wrong.
- `telegram-service.test.ts` — regression test for `&lt;p&gt;` (the
  original bug) must still pass.
- `telegram-legacy-format.test.ts` — full path through the service.

### Vitest baseline (REQUIRED REPORT)

Before starting work, run the full suite and capture the result:

```powershell
npx vitest run 2>&1 | tee vitest-before.txt | Out-Null
```

The expected baseline on current `main` is **9 failed files / 17 failed
tests** (see `docs/prompts/baseline-vitest.txt` for the full list). The
files relevant to this prompt — `telegram-html.test.ts`,
`telegram-service.test.ts`, `telegram-legacy-format.test.ts` — should
currently be **all green**. If they are not, stop and report.

After your changes, run again and **explicitly report**:
- Total: `Test Files X passed | Y failed (total)`
- Total tests: `Tests N passed | M failed (total)`
- Delta vs baseline: how many failures you added, fixed, or left alone
- Any pre-existing failures still present (i.e. the 17 from baseline that
  this task does not own)

If you fix or break any of the 17 baseline failures incidentally, call it
out — they belong to Tasks C and D.

---

## Acceptance criteria

1. `npx vitest run` shows the same 9 failed files as baseline, **no
   regressions in any previously-green test**, and your new tests added to
   the 3 telegram files all pass.
2. The 5 new tests in `telegram-html.test.ts` pass.
3. `git grep "^\s*formattedText = formattedText\.replace(/\\\\n{" telegram-service.ts`
   returns nothing (duplicate post-processing gone).
4. `safeFormatForTelegram` returns escaped plain text in the fallback path.
5. `decodeHtmlEntities` handles `&#xNN;` and `&#xNNNN;` in addition to
   `&#NN;`.
6. No `it.skip` introduced anywhere.
7. `git diff --check` clean.

---

## DO NOT FIX (conscious trade-offs)

- **Decode-first in `toTelegramHtml`** — the order of "decode entities,
  then reformat" remains. Escaped HTML coming from the editor is treated
  as markup; this is by design. Do not add a separate "do not decode
  inside `<pre>`" branch — the lift/restore pattern (item 1) is the
  correct fix.
- **`hasScraperData` zero-aggregate skip in
  `supplementFromScraper`** — keep the existing behavior from commit
  `0d117a5`.
- **`published_at = null` for `partially_published` content in
  `/publish/now`** — per-platform fallback via
  `getPublishedDisplayDate` is the intended display path.

---

## Out of scope

- Task B (status unification `partial` / `partially_published`)
- Tasks C and D (test cleanup)
- `docs/SCRAPER_API_INTEGRATION_ISSUES_ROMA.md` and the `_archive/docs/`
  files
- `git push`

---

## How to verify locally

```powershell
cd G:\Projects\smm-video
npx vitest run server/__tests__/telegram-html.test.ts server/__tests__/telegram-service.test.ts server/__tests__/telegram-legacy-format.test.ts
npx vitest run   # full suite, for the report
git diff --stat
git grep -E "aggressiveTagFixer|toTelegramHtml.*replace.*\\\\n\{3," server/services/social/telegram-service.ts
```

---

## Commit message

```
fix(telegram): preserve <pre>/<code> in toTelegramHtml, add hex entities

- Lift <pre>/<code> content to placeholders before convertMarkup,
  restore with escaping so escaped HTML inside code blocks survives
- Add &#xNN; / &#xNNNN; support to decodeHtmlEntities
- Trim trailing newline inside <pre>
- Drop duplicate post-processing in formatTextForTelegram (now done
  by toTelegramHtml itself)
- Escape residual &/<> in safeFormatForTelegram plain-text fallback
- Extend dropEmptyTags to clean empty <a> tags
- 5 new tests in telegram-html.test.ts; full suite no regressions
```
