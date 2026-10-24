#!/bin/bash
# ci-docs-only.sh — reads a PR's changed paths on stdin (one per line, renames give both names) and prints
# `true` when the PR is docs-only, `false` otherwise. ci.yml's `changes` job is the only caller; the heavy jobs
# are skipped (reported, green) on `true`. One rule, one place:
#   docs-only  = every path is *.md, or under docs/ or specs/
#   full run   = any other path, or any path under .github/, prisma/, the i18n dictionaries, package*.json,
#                Dockerfile*, docker-compose* — even a .md there (a workflow README, a prisma note) runs everything
#   no paths   = full run (nothing to prove it is docs)
set -euo pipefail
FORCE='^\.github/|^prisma/|^src/kernel/i18n/dictionaries/|^package[^/]*\.json$|(^|/)Dockerfile[^/]*$|(^|/)docker-compose[^/]*$'
DOCS='\.md$|^docs/|^specs/'
paths=$(grep -v '^[[:space:]]*$' || true)
if [ -z "$paths" ]; then echo false
elif echo "$paths" | grep -qE "$FORCE"; then echo false
elif echo "$paths" | grep -qvE "$DOCS"; then echo false
else echo true
fi
