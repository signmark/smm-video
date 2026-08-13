# merge-guard.sh — merge push guard (staged migration)

**Status: Phase A merged; host integration installed and pending independent
verification (task #59).**

This document is the integration contract for `scripts/merge-guard.sh`. The host
side is described in section 3; until its independent verification is recorded,
treat the canonical two-step flow as the intended path rather than a settled
obligation.

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

## 3. Integration contract (host, two steps)

The canonical flow is **two steps, not one**. A green gate is a statement about
the tree, not permission to merge: the reviewer verdict and the merge GO sit
between them, and that gap is deliberate. What the integration removes is a
different gap — assembling SHAs by hand and typing `git push`.

1. install the **reviewed exact version** of `merge-guard.sh` into the canonical
   merge host, checksum-pinned against the reviewed repository SHA. The checksum
   is computed from `git show <reviewed SHA>:scripts/merge-guard.sh`, never from
   a local copy;
2. a **green** gate emits an immutable receipt (root-owned, mode 0400) carrying
   the gated main, the candidate, the gate tree, the gate merge SHA, the guard
   checksum and the reviewed SHA it came from, plus a safe printed invocation
   quoting the receipt path. A red gate emits no receipt. The gate neither merges
   nor pushes;
3. after the review verdict and the merge GO, the executor runs the canonical
   approved-merge entrypoint with the receipt path and an explicit author and
   committer. It validates receipt ownership, mode, schema and checksum, matches
   the installed guard against both the receipt and the reviewed repository
   source, requires fresh `origin/main` to equal the gated main, builds the merge
   with the identity given on the command line, checks the tree, and then hands
   over to the guard — which performs the **sole** push. Nothing is `eval`-ed or
   copy-pasted out of the receipt, and there is no manual push gap after
   validation.

Scope limitation recorded honestly: the receipt checksum detects accidental
corruption and careless edits, not an actor who can write the file — ownership
and mode 0400 are what guard that. A raw `git push` also still bypasses the whole
path. Full non-bypass requires server-side branch
protection / a pre-receive hook — that is a separate owner/admin decision, not
part of task #55.

## 4. Tests

`scripts/merge-guard.test.sh` builds a throwaway bare remote + worktree and runs
the real guard. It covers: correct form accepts+pushes; and each of checks 0–6
fails closed with no push. No real origin/main, no /root; the pre-push/pre-receive
hooks used by the race test are throwaway hooks inside the temp fixtures, not repo
hooks. No force flags anywhere.
