-- F67 / lessons audit 30 + 32 (round 3 #7): `rate_source` VarChar + CHECK → one Postgres enum, and
-- `journal_categorised_by` loses `partner_default` (never written since journal #173).
-- Forward-only, no row rewritten by value: every cast is text → enum of the same word, and a value outside the
-- enum (impossible under the old CHECKs) fails the migration instead of being dropped.
-- The money-fact triggers compare `rate_source` with IS DISTINCT FROM — unchanged on an enum; ALTER TYPE does not
-- fire them (no UPDATE).

-- 0 · guard first, before anything changes: no row may still hold `partner_default`.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "journal_entries" WHERE "categorised_by"::text = 'partner_default') THEN
        RAISE EXCEPTION 'journal_entries.categorised_by = partner_default exists — map it before dropping the value';
    END IF;
END $$;

-- 1 · rate_source — the words of rates' `rateToBase` + a rate typed by hand + the bank's own base (expenses and
--     supplier invoices only).
CREATE TYPE "rate_source" AS ENUM ('same_currency', 'ecb_daily', 'ecb_nearest', 'manual', 'bank');

ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_rate_source_check";
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_rate_source_check";
ALTER TABLE "supplier_invoices" DROP CONSTRAINT "supplier_invoices_rate_source_check";

ALTER TABLE "journal_entries"
    ALTER COLUMN "rate_source" TYPE "rate_source" USING "rate_source"::text::"rate_source";
ALTER TABLE "expenses"
    ALTER COLUMN "rate_source" TYPE "rate_source" USING "rate_source"::text::"rate_source";
ALTER TABLE "supplier_invoices"
    ALTER COLUMN "rate_source" TYPE "rate_source" USING "rate_source"::text::"rate_source";

-- a journal entry's base is never the bank's own (the bank row *is* the entry): kept as before
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_rate_source_check" CHECK ("rate_source" <> 'bank');

-- 2 · journal_categorised_by without `partner_default`. Postgres cannot drop an enum value: a new type, the column
--     cast across, the old type dropped (the guard at the top refuses to run if a row still holds the value).
ALTER TYPE "journal_categorised_by" RENAME TO "journal_categorised_by_old";
CREATE TYPE "journal_categorised_by" AS ENUM ('manual', 'rule');
ALTER TABLE "journal_entries"
    ALTER COLUMN "categorised_by" TYPE "journal_categorised_by"
    USING "categorised_by"::text::"journal_categorised_by";
DROP TYPE "journal_categorised_by_old";
