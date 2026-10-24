#!/bin/bash
# merge-when-green.sh <pr> "<squash title>" [<expected-sha>] — polls the PR head's check runs; squash-merges when every check
# but `deploy` is completed and none is red (`skipped` counts as green), exits 1 on the first red. A docs-only PR
# is no exception: ci.yml's `changes` job reports in seconds and the heavy jobs report *skipped* — CI is the one
# gate, and the docs-only rule lives in scripts/ci-docs-only.sh only. Run it detached and read its log:
#   (setsid nohup scripts/merge-when-green.sh 46 "fix: …" "$(git rev-parse HEAD)" > /tmp/merge-46.log 2>&1 &)
# <expected-sha>: started right after a push, the PR's head can still be the previous commit for a few seconds —
# with it, nothing is judged until the head is that commit (lessons, #274).
set -u
PR=${1:?pr number}; TITLE=${2:?squash commit title}; EXPECT=${3:-}
# REST only (GraphQL is not reachable from every session): the repo from the origin URL, or GH_REPO.
REPO=${GH_REPO:-$(git remote get-url origin | sed -E "s#.*github\.com[:/]##; s#\.git\$##")}
BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT
MIN_RUNS=${MIN_RUNS:-5}   # changes, lint, typecheck, unit-test, build-and-e2e — fewer: not all created yet
POLL=${POLL:-10}          # seconds; short so a docs-only PR (all green in ~20 s) merges well under a minute
T0=$(date +%s)
DEADLINE=$(( T0 + ${TIMEOUT_MIN:-45} * 60 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  SHA=$(gh api "repos/$REPO/pulls/$PR" --jq '.head.sha')
  if [ -n "$EXPECT" ]; then
    if [ "$SHA" != "$EXPECT" ]; then sleep "$POLL"; continue; fi
    EXPECT=""   # seen once: from here on a newer push is handled like any other moved head
  fi
  RUNS=$(gh api "repos/$REPO/commits/$SHA/check-runs" --jq '.check_runs[] | select(.name != "deploy") | "\(.name):\(.status):\(.conclusion)"')
  if [ -z "$RUNS" ] || [ "$(echo "$RUNS" | wc -l)" -lt "$MIN_RUNS" ]; then sleep "$POLL"; continue; fi
  if echo "$RUNS" | grep -q "failure\|cancelled\|timed_out"; then echo "RED"; echo "$RUNS"; exit 1; fi
  if echo "$RUNS" | grep -qv ":completed:"; then sleep "$POLL"; continue; fi
  # a push that landed while we polled: the PR's head moved — never merge on the previous head's green
  if [ "$(gh api "repos/$REPO/pulls/$PR" --jq '.head.sha')" != "$SHA" ]; then sleep "$POLL"; continue; fi
  echo "GREEN $SHA after $(( $(date +%s) - T0 ))s"; echo "$RUNS"
  printf '{"merge_method":"squash","commit_title":%s,"commit_message":""}' \
    "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$TITLE")" > "$BODY"
  gh api "repos/$REPO/pulls/$PR/merge" --method PUT --input "$BODY" --jq '{merged, sha, message}'
  exit 0
done
echo "TIMEOUT"; exit 2
