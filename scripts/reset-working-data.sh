#!/usr/bin/env bash
# A fresh start, whole or in part (the owner, 2026-11-09): asks the period (everything · this year · this month ·
# from a date) and, scope by scope, what to drop — then shows what would go, asks for RESET, and only then writes.
#
#   scripts/reset-working-data.sh box      # the prod compose on the box — a backup first (scripts/backup.sh)
#   scripts/reset-working-data.sh laptop   # the dev database (af_dev) and Azurite — Git Bash on Windows, Docker only
#
# Never dropped: the login, the company profile and logo, the bank accounts, the VAT registrations, the BAS chart
# and its settings, the ECB and traktamente rates, the four system partners and the two seed rules, the schedules.
# The rules of what goes with what are in scripts/reset-working-data.sql (one transaction; a dry run first).
# The numbering continues after the last number kept — everything dropped = invoices start again at 001.
# Files: after the database, every stored file no document row points at any more is deleted.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET=${1:-}
COMPOSE="docker compose -f docker-compose.prod.yml"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

case "$TARGET" in
box) psql_run() { $COMPOSE exec -T db psql -U "${POSTGRES_USER:-af}" -d "${POSTGRES_DB:-af}" -v ON_ERROR_STOP=1 "$@"; } ;;
laptop) psql_run() { docker compose exec -T db-dev psql -U af -d af_dev -v ON_ERROR_STOP=1 "$@"; } ;;
*) echo "usage: $0 box|laptop" >&2; exit 2 ;;
esac

# ── the period ────────────────────────────────────────────────────────────────────────────────────────────
echo "What period?"
echo "  1) everything"
echo "  2) this year   (from $(date +%Y)-01-01)"
echo "  3) this month  (from $(date +%Y-%m)-01)"
echo "  4) from a date"
read -r -p "Choice [1-4]: " period
case "$period" in
1) FROM=-infinity; LABEL="everything" ;;
2) FROM="$(date +%Y)-01-01"; LABEL="from $FROM" ;;
3) FROM="$(date +%Y-%m)-01"; LABEL="from $FROM" ;;
4)
  read -r -p "From (YYYY-MM-DD): " FROM
  [[ "$FROM" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "Not a date: $FROM"; exit 1; }
  LABEL="from $FROM"
  ;;
*) echo "Nothing changed."; exit 1 ;;
esac

# ── the scopes ────────────────────────────────────────────────────────────────────────────────────────────
ask() {
  local answer
  read -r -p "  $1 [y/N] " answer
  [[ "$answer" =~ ^[yYjJoO] ]] && echo true || echo false
}
echo
echo "What to drop ($LABEL)? Dates: bank rows by booking date, invoices by issue date, expenses and supplier"
echo "invoices by their date, documents by upload date; partners, contracts, subscriptions and rules by creation."
BANK=$(ask "Banking — bank rows, their imports and CSV files, refund settlements on them")
DOCS=$(ask "Documents — uploads and their files (PDFs, photos), month packages")
INVOICES=$(ask "Invoices — invoices, quotes, credit notes, their PDFs, Swiss VAT declarations")
EXPENSES=$(ask "Expenses — expenses, supplier invoices, trips, settlements, empty expense groups")
SUBS=$(ask "Subscriptions")
PARTNERS=$(ask "Partners — partners, contacts, contracts (only those nothing kept still uses)")
RULES=$(ask "Your categorisation rules (the two default ones stay)")
VARS=(-v "from=$FROM" -v "bank=$BANK" -v "docs=$DOCS" -v "invoices=$INVOICES" -v "expenses=$EXPENSES"
  -v "subs=$SUBS" -v "partners=$PARTNERS" -v "rules=$RULES")
if [ "$BANK$DOCS$INVOICES$EXPENSES$SUBS$PARTNERS$RULES" = "falsefalsefalsefalsefalsefalsefalse" ]; then
  echo "Nothing chosen — nothing changed."
  exit 0
fi

# ── the dry run: what would go ────────────────────────────────────────────────────────────────────────────
echo
echo "On the $TARGET, $LABEL, this would drop (links, proposals and history of these go with them):"
psql_run -q "${VARS[@]}" -v commit=false <scripts/reset-working-data.sql
echo
read -r -p "Type RESET to drop them (anything else stops here): " answer
[ "$answer" = "RESET" ] || { echo "Nothing changed."; exit 1; }

# ── the real run ──────────────────────────────────────────────────────────────────────────────────────────
if [ "$TARGET" = box ]; then
  echo "▸ backup"
  scripts/backup.sh
fi
echo "▸ database"
psql_run -q "${VARS[@]}" -v commit=true <scripts/reset-working-data.sql >/dev/null

echo "▸ files no document points at any more"
psql_run -At -c "select substring(split_part(blob_url, '?', 1) from '/documents/(.*)\$') from documents where blob_url is not null" \
  | sed '/^$/d' >"$TMP/keep.txt"
if [ "$TARGET" = box ]; then
  docker run --rm --volumes-from "$($COMPOSE ps -q app)" -v "$TMP":/keep alpine sh -c '
    cd /data/documents || exit 0
    find . -type f | sed "s#^\./##" | grep -vxF -f /keep/keep.txt | while IFS= read -r f; do rm -f -- "$f"; done
    find . -mindepth 1 -type d -empty -delete
    echo "  $(find . -type f | wc -l) file(s) kept"'
else
  npx tsx scripts/sweep-blobs.ts "$TMP/keep.txt"
fi

echo "Done ($LABEL). Sign in as before."
