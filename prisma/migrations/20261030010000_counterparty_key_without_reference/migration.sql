-- D71 (F124 (6), 2026-10-30): a counterparty key is a *who*, never a *which*. The per-transaction reference at the
-- end of a card text — `MICROSOFT#G169504312` (the bill number), `MSFT * E0100ZW7M8` (an order code) — made every
-- month's row of the same merchant a different key, so rules made from a row, the counterparty memory (F116) and the
-- owner's history (F98) never recurred. The two expressions are `stripReference` in `modules/banking/counterparty.ts`,
-- kept identical by `counterparty-key-migration.test.ts`.
--
-- The key is derived from the bank's facts, which the lock trigger guards; it is stepped around for this one
-- statement (the migration role is the superuser — lessons, F113). Nothing else on the row moves.

ALTER TABLE "bank_transactions" DISABLE TRIGGER "bank_transactions_lock_facts";

UPDATE "bank_transactions"
   SET "counterparty_key" = COALESCE(
         NULLIF(
           btrim(
             regexp_replace(
               regexp_replace("counterparty_key", '\s*#[A-Z0-9][A-Z0-9-]*$', ''),
               '\s*\*\s*[A-Z0-9]*\d[A-Z0-9]*$', '')),
           ''),
         'UNKNOWN')
 WHERE "counterparty_key" ~ '(\s*#[A-Z0-9][A-Z0-9-]*|\s*\*\s*[A-Z0-9]*\d[A-Z0-9]*)$';

ALTER TABLE "bank_transactions" ENABLE TRIGGER "bank_transactions_lock_facts";

-- A rule made from such a row (`contains MICROSOFT#G169504312`, `createRuleFromTransaction`) matched that one row
-- only; with the same cut it says what the owner meant: every row of the merchant.
UPDATE "categorisation_rules"
   SET "match_pattern" = btrim(
         regexp_replace(
           regexp_replace("match_pattern", '\s*#[A-Za-z0-9][A-Za-z0-9-]*$', ''),
           '\s*\*\s*[A-Za-z0-9]*\d[A-Za-z0-9]*$', ''))
 WHERE "match_field" = 'counterparty_key'
   AND "match_type" IN ('exact', 'contains')
   AND "match_pattern" ~ '(\s*#[A-Za-z0-9][A-Za-z0-9-]*|\s*\*\s*[A-Za-z0-9]*\d[A-Za-z0-9]*)$'
   AND btrim(regexp_replace(regexp_replace("match_pattern", '\s*#[A-Za-z0-9][A-Za-z0-9-]*$', ''), '\s*\*\s*[A-Za-z0-9]*\d[A-Za-z0-9]*$', '')) <> '';
