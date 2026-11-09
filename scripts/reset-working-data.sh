#!/usr/bin/env bash
# A fresh start (the owner, 2026-11-09): empty the working items — bank rows and imports, documents and their
# files (PDFs, CSVs, packages), partners, contracts, invoices, expenses, supplier invoices, subscriptions, links,
# proposals, the journal, the audit trail, the number series (invoices and expenses start again at 001) and the
# owner's rules — and keep what a fresh start needs:
#
#   kept      the login (users, sessions, the organisation and its members, the preferences),
#             the company profile and its logo, the bank accounts, the VAT registrations,
#             the BAS chart and its settings, the ECB rates, the traktamente rates, the bank formats,
#             the four system partners (bank, tax office…) with the two seed rules that point at the bank,
#             the scheduled jobs (the nightly rates fetch)
#   emptied   everything else in the list below, and every stored file
#
#   scripts/reset-working-data.sh box      # the prod compose on the box: a backup first (scripts/backup.sh)
#   scripts/reset-working-data.sh laptop   # the dev database (af_dev) and Azurite — Git Bash on Windows, Docker only
#
# Asks for RESET before it writes; one transaction for the database (all or nothing). TRUNCATE without CASCADE:
# if a kept table still pointed at an emptied one, Postgres refuses and nothing changes.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET=${1:-}
COMPOSE="docker compose -f docker-compose.prod.yml"

read -r -d '' SQL <<'SQL' || true
BEGIN;
TRUNCATE
  package_builds, swiss_vat_declarations,
  settlements, trips, expenses, expense_groups,
  supplier_invoice_lines, supplier_invoices,
  subscription_pauses, subscription_prices, subscriptions,
  invoice_lines, invoices, contract_rates, contracts, number_series,
  proposals, links, journal_entries, bank_transactions, bank_imports,
  documents, partner_contacts, audit_logs, table_preferences
  RESTART IDENTITY;
-- the owner's rules go; the two seed rules (bank fees, savings interest) stay, with the bank as their partner
DELETE FROM categorisation_rules WHERE source <> 'seed';
-- every partner but the system ones (F129) — they come back by themselves if missing (the next import)
DELETE FROM partners WHERE system_role IS NULL;
-- queued work about rows that no longer exist (OCR, proposals); the schedules stay
DELETE FROM pgboss.job;
COMMIT;
SQL

COUNTS="select 'bank rows', count(*) from bank_transactions union all select 'documents', count(*) from documents
  union all select 'partners', count(*) from partners union all select 'invoices', count(*) from invoices
  union all select 'expenses', count(*) from expenses union all select 'supplier invoices', count(*) from supplier_invoices
  union all select 'rules', count(*) from categorisation_rules"

confirm() {
  echo
  echo "This deletes the working items above and every stored file on the $TARGET. It cannot be undone$1."
  read -r -p "Type RESET to go on: " answer
  [ "$answer" = "RESET" ] || { echo "Nothing changed."; exit 1; }
}

case "$TARGET" in
box)
  psql_box() { $COMPOSE exec -T db psql -U "${POSTGRES_USER:-af}" -d "${POSTGRES_DB:-af}" -v ON_ERROR_STOP=1 "$@"; }
  echo "Now on the box:"
  psql_box -At -F ': ' -c "$COUNTS"
  confirm " (a backup is taken first, in ${BACKUP_DIR:-./backups})"
  scripts/backup.sh
  echo "▸ database"
  psql_box -q <<<"$SQL"
  echo "▸ files (the documents volume)"
  docker run --rm --volumes-from "$($COMPOSE ps -q app)" alpine sh -c 'rm -rf /data/documents/* /data/documents/.[!.]* 2>/dev/null; true'
  ;;
laptop)
  # through the dev container's own psql — nothing to install on Windows (run it from Git Bash in C:\af)
  psql_dev() { docker compose exec -T db-dev psql -U af -d af_dev -v ON_ERROR_STOP=1 "$@"; }
  echo "Now on the laptop (af_dev):"
  psql_dev -At -F ': ' -c "$COUNTS"
  confirm ""
  echo "▸ database"
  psql_dev -q <<<"$SQL"
  echo "▸ files (Azurite: the volume goes, the container comes back empty)"
  docker compose rm -sf azurite >/dev/null
  # the compose project's volume (`af_azurite-data` in C:\af)
  docker volume rm "$(basename "$PWD" | tr '[:upper:]' '[:lower:]')_azurite-data" >/dev/null 2>&1 || true
  docker compose up -d azurite >/dev/null
  npx tsx scripts/setup-azurite-cors.ts >/dev/null 2>&1 || echo "  (run scripts/dev-env.sh azurite if the browser upload complains about CORS)"
  ;;
*)
  echo "usage: $0 box|laptop" >&2
  exit 2
  ;;
esac

echo "Done — a fresh start. Sign in as before; import the bank CSVs, add the partners."
