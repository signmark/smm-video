#!/usr/bin/env bash
#
# merge-guard.test.sh — executable tests for scripts/merge-guard.sh.
#
# Each test builds a throwaway bare "origin" + a merge worktree, then runs the
# REAL guard against it. No real origin/main, no /root, no hooks, no force.
#
# Exit 0 only if ALL assertions hold.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$ROOT/scripts/merge-guard.sh"

pass=0
failcnt=0
ok()  { echo "ok   $1"; pass=$((pass+1)); }
bad() { echo "FAIL $1"; failcnt=$((failcnt+1)); }

# ── Fixture state, filled by new_fixture ──────────────────────
BARE=""; SEED=""; WT=""; CANDIDATE=""; MERGE_TREE=""; MERGE_SHA=""; BASE_MAIN=""
EXPECT_PUSH=""

# Create a fresh isolated bare remote + seed + worktree with a merge built.
# kwargs consumed via a small inline DSL below each case.
new_fixture() {
  local d
  d="$(mktemp -d /tmp/merge-guard-test.XXXXXX)"
  FRESH_DIR="$d"
  BARE="$d/origin.git"
  SEED="$d/seed"
  WT="$d/worktree"

  git init -q --bare "$BARE"
  git -c init.defaultBranch=main init -q "$SEED"
  git -C "$SEED" config user.name  "Base Author"
  git -C "$SEED" config user.email "base@example.com"
  echo v1 > "$SEED/main.txt"
  git -C "$SEED" add -A
  git -C "$SEED" commit -qm "base main"
  git -C "$SEED" remote add origin "$BARE"
  git -C "$SEED" push -q origin main
  git -C "$BARE" symbolic-ref HEAD refs/heads/main
  BASE_MAIN="$(git -C "$SEED" rev-parse main)"

  git -C "$SEED" checkout -qb candidate
  echo feat > "$SEED/feat.txt"
  git -C "$SEED" add -A
  git -C "$SEED" commit -qm "candidate feature"
  git -C "$SEED" push -q origin candidate
  CANDIDATE="$(git -C "$SEED" rev-parse candidate)"

  git clone -q "$BARE" "$WT"
  git -C "$WT" remote set-url origin "$BARE"
  git -C "$WT" config user.name  "Executor Name"
  git -C "$WT" config user.email "executor@example.com"
  git -C "$WT" fetch -q origin
}

# Advance remote main by one commit (simulate concurrent merge during gate).
advance_remote() {
  git -C "$SEED" checkout -q main
  echo "sneak-$RANDOM" >> "$SEED/main.txt"
  git -C "$SEED" add -A
  git -C "$SEED" commit -qm "advance"
  git -C "$SEED" push -q origin main
}

# Build no-ff merge of candidate onto origin/main in the worktree.
build_merge() {
  git -C "$WT" checkout -q origin/main
  git -C "$WT" merge --no-ff -q -m "merge candidate" origin/candidate
  MERGE_SHA="$(git -C "$WT" rev-parse HEAD)"
  MERGE_TREE="$(git -C "$WT" rev-parse 'HEAD^{tree}')"
  EXPECT_PUSH="$MERGE_SHA"
}

run() {
  local expect="$1" needle="$2"
  local out rc pushed
  out="$(cd "$WT" && "$GUARD" "${ARGS[@]}" 2>&1)"
  rc=$?
  pushed="$(git -C "$BARE" rev-parse main 2>/dev/null || echo 'none')"
  if [ "$expect" = accept ]; then
    if [ "$rc" -eq 0 ] && [ "$pushed" = "$EXPECT_PUSH" ]; then
      ok "$needle: accept + pushed"
    else
      bad "$needle: accept rc=$rc pushed=$pushed expect=$EXPECT_PUSH"
      echo "$out" | sed 's/^/      | /'
    fi
  else
    if [ "$rc" -ne 0 ] && echo "$out" | grep -q "$needle"; then
      ok "$needle: reject rc=$rc (remote main untouched: $pushed)"
    else
      bad "$needle: reject rc=$rc"
      echo "$out" | sed 's/^/      | /'
    fi
  fi
}

echo "=== merge-guard.sh tests ==="

# ── 1. Correct form → accept, push ───────────────────────────
new_fixture
build_merge
ARGS=( --candidate "$CANDIDATE" --tree "$MERGE_TREE" --base-main "$BASE_MAIN" \
       --author "Executor Name <executor@example.com>" \
       --committer "Executor Name <executor@example.com>" )
run accept "correct merge"

# ── 2. base-main advanced during gate → reject ───────────────
new_fixture
build_merge
advance_remote
ARGS=( --candidate "$CANDIDATE" --tree "$MERGE_TREE" --base-main "$BASE_MAIN" \
       --author "Executor Name <executor@example.com>" \
       --committer "Executor Name <executor@example.com>" )
run reject "main advanced"

# ── 3. wrong candidate (second parent) ───────────────────────
new_fixture
build_merge
ARGS=( --candidate "0000000000000000000000000000000000000000" --tree "$MERGE_TREE" --base-main "$BASE_MAIN" \
       --author "Executor Name <executor@example.com>" \
       --committer "Executor Name <executor@example.com>" )
run reject "second parent"

# ── 4. wrong tree ────────────────────────────────────────────
new_fixture
build_merge
ARGS=( --candidate "$CANDIDATE" --tree "0000000000000000000000000000000000000000" --base-main "$BASE_MAIN" \
       --author "Executor Name <executor@example.com>" \
       --committer "Executor Name <executor@example.com>" )
run reject "tree"

# ── 5. wrong author ──────────────────────────────────────────
new_fixture
build_merge
ARGS=( --candidate "$CANDIDATE" --tree "$MERGE_TREE" --base-main "$BASE_MAIN" \
       --author "Impostor <bad@example.com>" \
       --committer "Executor Name <executor@example.com>" )
run reject "author"

# ── 6. wrong committer ───────────────────────────────────────
new_fixture
build_merge
ARGS=( --candidate "$CANDIDATE" --tree "$MERGE_TREE" --base-main "$BASE_MAIN" \
       --author "Executor Name <executor@example.com>" \
       --committer "Impostor <bad@example.com>" )
run reject "committer"

# ── 7. stale local main: HEAD^1 != fresh origin/main ─────────
new_fixture
# Build the merge against the OLD base, then advance remote after, so the
# merge's first parent is stale.
git -C "$WT" checkout -q origin/main
git -C "$WT" merge --no-ff -q -m "merge candidate" origin/candidate
MERGE_SHA="$(git -C "$WT" rev-parse HEAD)"
MERGE_TREE="$(git -C "$WT" rev-parse 'HEAD^{tree}')"
EXPECT_PUSH="$MERGE_SHA"
advance_remote
# Pass base-main = old BASE_MAIN (so check #0 also fires on the same run).
# To isolate first-parent specifically, ALSO run a variant where base-main is
# set to the now-current remote main, so only first-parent can fire.
NEW_MAIN="$(git -C "$BARE" rev-parse main)"
ARGS=( --candidate "$CANDIDATE" --tree "$MERGE_TREE" --base-main "$NEW_MAIN" \
       --author "Executor Name <executor@example.com>" \
       --committer "Executor Name <executor@example.com>" )
run reject "first parent"

# ── 8. not a merge (linear/ff commit) → reject ───────────────
new_fixture
# Build a plain commit on top of origin/main (single parent, not a merge)
git -C "$WT" checkout -q origin/main
git -C "$WT" config user.name "Executor Name"
git -C "$WT" config user.email "executor@example.com"
echo linear > "$WT/linear.txt"
git -C "$WT" add -A
git -C "$WT" commit -qm "linear, not a merge"
MERGE_SHA="$(git -C "$WT" rev-parse HEAD)"
MERGE_TREE="$(git -C "$WT" rev-parse 'HEAD^{tree}')"
EXPECT_PUSH="$MERGE_SHA"
ARGS=( --candidate "$CANDIDATE" --tree "$MERGE_TREE" --base-main "$BASE_MAIN" \
       --author "Executor Name <executor@example.com>" \
       --committer "Executor Name <executor@example.com>" )
run reject "2-parent merge"

echo ""
echo "=== results: $pass passed, $failcnt failed ==="
[ "$failcnt" -eq 0 ]
