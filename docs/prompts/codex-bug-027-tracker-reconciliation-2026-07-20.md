# BUG-027 tracker reconciliation — 2026-07-20

Status: **REVIEWED — FIX ALREADY IN GIT, RETEST REQUIRED**

Reviewer: Codex  
Tracker / sheet owner: Mavis (Minimax)  
Code changes by Codex: **none**

## Finding

`docs/tester-bugs/state.json` currently marks BUG-027 as:

```text
partial_fix_in_git_new_task_needed
```

and lists only `a2d3d65` and `88cc1a2`. That assessment is stale. The exact reported
DeepSeek artifact was addressed later by:

- `5748268` — `fix: sanitize generated social content`
- `85bc523` — `fix: preserve formatting in generated posts`

## Code verification

The shared `/api/generate` and `/api/generate-content` route:

1. Adds `getGeneratedSocialContentRules(platform)` to the system prompt for explicit
   social-platform requests.
2. Applies `cleanGeneratedSocialContent(result.content, platform)` to the generated
   response.

The cleanup covers the exact BUG-027 report:

- removes an intro beginning with `Вот вариант поста ...`;
- removes the `Заголовок:` label;
- removes standalone formatting-marker lines such as `*`;
- removes Markdown headings and paired emphasis markers;
- preserves real paragraph breaks and dash lists;
- preserves hashtags and emoji outside VK;
- for VK only, removes hashtags and emoji according to the current product contract.

`server/__tests__/generated-social-content.test.ts` contains a regression named:

```text
cleans the exact DeepSeek VK artifact pattern reported by testers
```

Its input includes the tester-reported intro, standalone `*`, `Заголовок:`, `✅`,
`📌`, and VK hashtags.

## Verification run

```text
npx vitest run \
  server/__tests__/generated-social-content.test.ts \
  server/__tests__/ai-service.test.ts

2 files passed
16 tests passed
```

Working tree was clean before this review.

## Mavis follow-up

Do not open a duplicate Codex implementation task. Reconcile BUG-027 in
`docs/tester-bugs/state.json`:

- add `5748268` and `85bc523` to `fix_commits`;
- change the status to `fix_in_git_awaiting_retest`;
- update the fix summary to reference the exact regression coverage;
- move the Google Sheet row to tester/retest according to the tracker workflow.

The tester should reproduce through the normal social-content generation UI with
DeepSeek and VK selected. If the artifact still appears, capture the exact request
route and payload because that would indicate a generation path bypassing
`server/routes/ai.ts`, not missing cleanup in the verified route.

