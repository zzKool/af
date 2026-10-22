#!/bin/bash
# merge-when-green.sh <pr> "<squash title>" — polls the PR head's check runs; squash-merges when every check
# but `deploy` passes, exits 1 on the first red. Run it detached and read its log:
#   (setsid nohup scripts/merge-when-green.sh 46 "fix: …" > /tmp/merge-46.log 2>&1 &)
set -u
PR=${1:?pr number}; TITLE=${2:?squash commit title}
# REST only (GraphQL is not reachable from every session): the repo from the origin URL, or GH_REPO.
REPO=${GH_REPO:-$(git remote get-url origin | sed -E "s#.*github\.com[:/]##; s#\.git\$##")}
BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT
# Docs-only PR (every file matches ci.yml's paths-ignore): CI never starts, so there is nothing to wait for.
FILES=$(gh api "repos/$REPO/pulls/$PR/files" --paginate --jq '.[].filename')
if [ -n "$FILES" ] && ! echo "$FILES" | grep -qvE '\.md$|^docs/|^_bmad[^/]*/'; then
  echo "DOCS-ONLY — no CI to wait for"
  printf '{"merge_method":"squash","commit_title":%s,"commit_message":""}' \
    "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$TITLE")" > "$BODY"
  gh api "repos/$REPO/pulls/$PR/merge" --method PUT --input "$BODY" --jq '{merged, sha, message}'
  exit 0
fi
MIN_RUNS=${MIN_RUNS:-4}   # lint, typecheck, unit-test, build — fewer means the run has not been created yet
for _ in $(seq 1 80); do
  SHA=$(gh api "repos/$REPO/pulls/$PR" --jq '.head.sha')
  RUNS=$(gh api "repos/$REPO/commits/$SHA/check-runs" --jq '.check_runs[] | select(.name != "deploy") | "\(.name):\(.status):\(.conclusion)"')
  if [ -z "$RUNS" ] || [ "$(echo "$RUNS" | wc -l)" -lt "$MIN_RUNS" ]; then sleep 20; continue; fi
  if echo "$RUNS" | grep -q "failure\|cancelled\|timed_out"; then echo "RED"; echo "$RUNS"; exit 1; fi
  if echo "$RUNS" | grep -qv ":completed:"; then sleep 30; continue; fi
  # a push that landed while we polled: the PR's head moved — never merge on the previous head's green
  if [ "$(gh api "repos/$REPO/pulls/$PR" --jq '.head.sha')" != "$SHA" ]; then sleep 20; continue; fi
  echo "GREEN $SHA"; echo "$RUNS"
  printf '{"merge_method":"squash","commit_title":%s,"commit_message":""}' \
    "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$TITLE")" > "$BODY"
  gh api "repos/$REPO/pulls/$PR/merge" --method PUT --input "$BODY" --jq '{merged, sha, message}'
  exit 0
done
echo "TIMEOUT"; exit 2
