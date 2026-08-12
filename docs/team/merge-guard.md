# merge-guard.sh — merge push guard (staged migration)

**Status: Phase A in review. NOT yet wired into the canonical merge path.**

This document is the integration contract for `scripts/merge-guard.sh`. Until the
host-integration subtask lands (point 3), the guard is a repo-contained,
reviewed script with executable tests but is **not** yet a required step in the
production merge workflow. Treat "run merge-guard.sh before push" as a
still-open migration note, not a current obligation.

## 1. Why

The 12.08 main-merge drift was caused by three checks being done "by eye":

1. the `--no-ff` merge was built from a **stale local main** (`3ebe0d3ab` instead
   of freshly fetched `abe1909b2b`), so first-parent lineage went stale;
2. the committer identity leaked from the shared prod host git config
   (`Mimo_2_5` instead of the actual executor);
3. nothing re-verified the tree against the tree that actually passed the gate.

Each failure is silent; a wrong merge pushes cleanly and is only noticed later
during independent verification.

## 2. What the guard enforces (fail-closed)

`scripts/merge-guard.sh` takes explicit inputs and performs its own `git fetch
origin main`; it never consults local `main`. It rejects (non-zero, named
diagnostic with both values, nothing pushed) if any of:

| # | check | rejects |
|---|-------|---------|
| 0 | fresh `origin/main` == `--gated-main` | main advanced while the gate ran |
| 1 | HEAD is exactly a 2-parent merge | ff / squash / octopus / extra parent |
| 2 | `HEAD^1` == fresh `origin/main` | stale local main |
| 3 | `HEAD^2` == `--candidate` | wrong candidate |
| 4 | `HEAD^{tree}` == `--gate-tree` | gate-tree mismatch / hand-resolved conflicts |
| 5 | author == `--author` | wrong/shared identity |
| 6 | committer == `--committer` | wrong/shared identity |

On pass it performs the single plain `git push origin HEAD:main`. There is no
`--force` / `--force-with-lease` anywhere; between the final fetch and the push
there is no operator step, so a concurrent main advance surfaces as a normal
non-fast-forward rejection.

## 3. Integration contract (host-integration subtask, not yet done)

To close task #55, a follow-up host-integration step (owner: infra/Tech Lead)
must:

1. install the **reviewed exact version** of `merge-guard.sh` (checksum-pinned
   against the reviewed repository SHA) into the canonical merge host;
2. make the canonical gate invoke the trusted wrapper as its final push step —
   the wrapper itself performs the one `git push`; there is **no manual push gap**
   after it in the normal workflow;
3. verify checksum/version match to the reviewed repository SHA.

Scope limitation recorded honestly: a repository-side wrapper can still be
bypassed by a raw `git push`. Full non-bypass requires server-side branch
protection / a pre-receive hook — that is a separate owner/admin decision, not
part of task #55.

## 4. Tests

`scripts/merge-guard.test.sh` builds a throwaway bare remote + worktree and runs
the real guard. It covers: correct form accepts+pushes; and each of checks 0–6
fails closed with no push. No real origin/main, no /root; the pre-push/pre-receive
hooks used by the race test are throwaway hooks inside the temp fixtures, not repo
hooks. No force flags anywhere.
