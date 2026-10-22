#!/bin/bash
# Empty the business tables the e2e journeys fill (all tenants) so a local run starts like CI's fresh database.
# Then `npm run seed`. Uses the test database's migration role (docker-compose.yml) unless DATABASE_TEST_MIGRATION_URL is set.
set -eu
URL=${DATABASE_TEST_MIGRATION_URL:-postgresql://af:test@localhost:5433/af_test}
psql "$URL" -v ON_ERROR_STOP=1 -q <<'SQL'
TRUNCATE package_builds, settlement_lines, settlements, trips, expenses, expense_groups, links, journal_entries,
  bank_transactions, bank_imports, invoice_lines, invoices, documents, number_series, audit_logs RESTART IDENTITY CASCADE;
DELETE FROM normalbelopp WHERE year <> 2025;
DELETE FROM categorisation_rules WHERE source <> 'seed';
DELETE FROM pgboss.job;
SQL
echo "e2e data reset — now: DATABASE_URL=$URL npx tsx prisma/seed.ts   (the seed needs the migration role, not the RLS app role)"
