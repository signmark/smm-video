#!/usr/bin/env bash
#
# merge-guard.sh — fail-close wrapper for the project main merge push.
#
# This is the single trusted path that VALIDATES and PUSHES a main merge. It is
# called from the merge worktree immediately before the push, and it does not
# return control to the operator between the final fetch and the push — so a
# remote advance between "checked" and "pushed" can only surface as a normal
# non-fast-forward rejection, never as a silently stale push.
#
# The guard never reads the local `main` branch; it fetches origin/main itself
# and compares only against that fresh ref. That is precisely the 12.08 defect:
# a no-ff merge made from a stale local main.
#
# What it enforces (fail-closed, one diagnostic per failed check, both values):
#   0. fresh origin/main == --base-main (main did not advance during the gate)
#   1. HEAD is a real 2-parent merge (rejects ff / squash / octopus / extra parent)
#   2. HEAD^1  == fresh origin/main
#   3. HEAD^2  == --candidate (exact SHA)
#   4. HEAD^{tree} == --tree (the tree the green gate ran on)
#   5. author    == --author  (explicit, never read from shared git config)
#   6. committer == --committer
#
# On any failure: non-zero exit, nothing pushed. On success it performs the one
# plain `git push` (no --force / --force-with-lease flags exist anywhere here).
#
# Usage:
#   merge-guard.sh \
#     --candidate <sha> --tree <sha> --base-main <sha> \
#     --author '<name> <email>' --committer '<name> <email>'
#
# All inputs are REQUIRED; the guard infers nothing from shared identity.
set -euo pipefail

usage() {
  echo "usage: $0 --candidate <sha> --tree <sha> --base-main <sha> --author '<n> <e>' --committer '<n> <e>'" >&2
  exit 2
}

# ── Parse inputs ──────────────────────────────────────────────
candidate=""; tree=""; base_main=""; author=""; committer=""
while [ $# -gt 0 ]; do
  case "$1" in
    --candidate) candidate="${2:-}"; shift 2 ;;
    --tree)      tree="${2:-}"; shift 2 ;;
    --base-main) base_main="${2:-}"; shift 2 ;;
    --author)    author="${2:-}"; shift 2 ;;
    --committer) committer="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

if [ -z "$candidate" ] || [ -z "$tree" ] || [ -z "$base_main" ] || [ -z "$author" ] || [ -z "$committer" ]; then
  echo "merge-guard: --candidate, --tree, --base-main, --author, --committer are all required" >&2
  usage
fi

# ── Fresh remote only ─────────────────────────────────────────
# This is the SECOND and final fetch: the merge must already have been built
# from a freshly-fetched origin/main; here we re-fetch to close the race window.
if ! git fetch origin main >/dev/null 2>&1; then
  echo "merge-guard: FAILED — git fetch origin main" >&2
  exit 1
fi

origin_main="$(git rev-parse 'refs/remotes/origin/main')"

# ── HEAD shape and identity ───────────────────────────────────
head_first="$(git rev-parse 'HEAD^1' 2>/dev/null || echo '')"
head_second="$(git rev-parse 'HEAD^2' 2>/dev/null || echo '')"
head_tree="$(git rev-parse 'HEAD^{tree}')"
head_author="$(git log -1 --format='%an <%ae>' HEAD)"
head_committer="$(git log -1 --format='%cn <%ce>' HEAD)"
head_parent_count="$(git log -1 --format='%P' HEAD | wc -w)"

fail=0

# 0. fresh origin/main must equal the main the green gate ran against
if [ "$origin_main" != "$base_main" ]; then
  echo "merge-guard: FAIL main advanced while the gate was running" >&2
  echo "  expected: $base_main (main the gate ran on)" >&2
  echo "  actual:   $origin_main (fresh origin/main)" >&2
  fail=1
fi

# 1. HEAD must be exactly a 2-parent merge
if [ "$head_parent_count" -ne 2 ]; then
  echo "merge-guard: FAIL not a 2-parent merge (parent count = $head_parent_count)" >&2
  echo "  expected: 2 parents (merge commit)" >&2
  echo "  actual:   $head_parent_count parent(s) — ff/squash/octopus/linear rejected" >&2
  fail=1
fi

# 2. first parent == fresh origin/main
if [ "$head_first" != "$origin_main" ]; then
  echo "merge-guard: FAIL first parent is not fresh origin/main" >&2
  echo "  expected: $origin_main" >&2
  echo "  actual:   ${head_first:-<none>}" >&2
  fail=1
fi

# 3. second parent == candidate SHA
if [ "$head_second" != "$candidate" ]; then
  echo "merge-guard: FAIL second parent is not the candidate" >&2
  echo "  expected: $candidate" >&2
  echo "  actual:   ${head_second:-<none>}" >&2
  fail=1
fi

# 4. tree == gate tree
if [ "$head_tree" != "$tree" ]; then
  echo "merge-guard: FAIL tree does not match the gate tree" >&2
  echo "  expected: $tree" >&2
  echo "  actual:   $head_tree" >&2
  fail=1
fi

# 5. author identity exact
if [ "$head_author" != "$author" ]; then
  echo "merge-guard: FAIL author identity mismatch" >&2
  echo "  expected: $author" >&2
  echo "  actual:   $head_author" >&2
  fail=1
fi

# 6. committer identity exact
if [ "$head_committer" != "$committer" ]; then
  echo "merge-guard: FAIL committer identity mismatch" >&2
  echo "  expected: $committer" >&2
  echo "  actual:   $head_committer" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "merge-guard: REJECTED — nothing pushed." >&2
  exit 1
fi

# ── Push (plain; the only push in this path) ──────────────────
# No --force / --force-with-lease anywhere. A remote advance between the fetch
# above and this push surfaces as a normal non-fast-forward failure here.
echo "merge-guard: OK — parents/tree/author/committer all match; pushing main."
git push origin HEAD:main
