-- The link is the only payment record (F114, D60 — specs/linking/payment-record.md).
-- A `justifies` / `settles` link carries `allocated_amount` in the entity's currency and `allocated_base` = what the
-- bank row gave for it; paid / open and the FX difference are derived from Σ links. The entity's base is written
-- once at its date (never the bank's). Private payers are bank accounts (`role = owner_private`). Goes:
-- `paid_amount`, `paid_currency`, `base_provisional`, `payment_sources`, `settlement_lines`, the settlement's
-- derived columns. Comes: the two invariants as triggers (A1, A2). Counts are logged as NOTICEs; a record the
-- rules cannot rewrite fails the migration by name — nothing changed.

-- ----------------------------------------------------------------------------
-- 0. the old locks come off (they name columns that go); the (tenant_id, id) keys for the composite FKs (D63)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS "expenses_lock_when_settled" ON "expenses";
DROP FUNCTION IF EXISTS expenses_lock_when_settled();
DROP TRIGGER IF EXISTS "settlements_lock" ON "settlements";
DROP FUNCTION IF EXISTS settlements_lock();
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenant_id_id_key" UNIQUE ("tenant_id", "id");
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenant_id_id_key" UNIQUE ("tenant_id", "id");

-- ----------------------------------------------------------------------------
-- 1. private instruments become bank accounts (US4)
-- ----------------------------------------------------------------------------
ALTER TABLE "bank_accounts" ALTER COLUMN "bank_format_id" DROP NOT NULL;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_format_check"
    CHECK ("role" = 'owner_private' OR "bank_format_id" IS NOT NULL);

CREATE TEMP TABLE payer_map ("source_id" UUID PRIMARY KEY, "account_id" UUID NOT NULL) ON COMMIT DROP;
INSERT INTO payer_map
SELECT ps."id", ps."bank_account_id"
  FROM "payment_sources" ps
  JOIN "bank_accounts" a ON a."id" = ps."bank_account_id" AND a."tenant_id" = ps."tenant_id"
 WHERE ps."kind" = 'bank_account';
WITH created AS (
    INSERT INTO "bank_accounts" ("tenant_id", "account_alias", "account_number", "currency", "bank_format_id", "role",
                                 "created_at", "updated_at", "created_by", "source")
    SELECT ps."tenant_id", ps."label", ps."label", ps."currency", NULL, 'owner_private',
           ps."created_at", now(), ps."created_by", 'migration'
      FROM "payment_sources" ps
     WHERE ps."kind" = 'private'
    RETURNING "id", "tenant_id", "account_alias"
)
INSERT INTO payer_map
SELECT ps."id", c."id"
  FROM "payment_sources" ps
  JOIN created c ON c."tenant_id" = ps."tenant_id" AND c."account_alias" = ps."label"
 WHERE ps."kind" = 'private';
DO $$
DECLARE
    orphan text;
    n_private int;
BEGIN
    SELECT string_agg(ps."label", ', ') INTO orphan
      FROM "payment_sources" ps LEFT JOIN payer_map m ON m."source_id" = ps."id"
     WHERE m."source_id" IS NULL;
    IF orphan IS NOT NULL THEN
        RAISE EXCEPTION 'link_payment_record: payment source(s) point at no bank account — nothing changed: %', orphan
            USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO n_private FROM "bank_accounts" WHERE "role" = 'owner_private';
    RAISE NOTICE 'link_payment_record: % private instrument(s) now bank accounts', n_private;
END $$;

-- ----------------------------------------------------------------------------
-- 2. the payer of an expense and of a subscription: a bank account, composite FK, RESTRICT
-- ----------------------------------------------------------------------------
ALTER TABLE "expenses" ADD COLUMN "paid_from_account_id" UUID;
UPDATE "expenses" e SET "paid_from_account_id" = m."account_id" FROM payer_map m WHERE m."source_id" = e."payment_source_id";
ALTER TABLE "subscriptions" ADD COLUMN "paid_from_account_id" UUID;
UPDATE "subscriptions" s SET "paid_from_account_id" = m."account_id" FROM payer_map m WHERE m."source_id" = s."payment_source_id";
DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg("key", ', ') INTO missing FROM "expenses" WHERE "paid_from_account_id" IS NULL;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'link_payment_record: expense(s) without a payer — nothing changed: %', missing USING ERRCODE = 'P0001';
    END IF;
    SELECT string_agg("name", ', ') INTO missing FROM "subscriptions" WHERE "paid_from_account_id" IS NULL;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'link_payment_record: subscription(s) without a payer — nothing changed: %', missing USING ERRCODE = 'P0001';
    END IF;
END $$;
ALTER TABLE "expenses" ALTER COLUMN "paid_from_account_id" SET NOT NULL;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_paid_from_account_id_fkey"
    FOREIGN KEY ("tenant_id", "paid_from_account_id") REFERENCES "bank_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "expenses_tenant_id_paid_from_account_id_idx" ON "expenses"("tenant_id", "paid_from_account_id");
ALTER TABLE "subscriptions" ALTER COLUMN "paid_from_account_id" SET NOT NULL;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_paid_from_account_id_fkey"
    FOREIGN KEY ("tenant_id", "paid_from_account_id") REFERENCES "bank_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "subscriptions_tenant_id_paid_from_account_id_idx" ON "subscriptions"("tenant_id", "paid_from_account_id");

-- ----------------------------------------------------------------------------
-- 3. links: allocated_base — what the bank row gave, in the tenant's base. A same-currency allocation takes the
--    row's base pro rata (the link that exhausts the row takes the exact remainder); today's cross-currency
--    attachment (one link in the PAID currency, the whole entity) becomes the entity's full amount in ITS currency
--    with the row's whole base.
-- ----------------------------------------------------------------------------
ALTER TABLE "links" ADD COLUMN "allocated_base" DECIMAL(15, 2);
WITH ent AS (
    SELECT 'expense'::text AS t, "id", "currency", "amount" AS amt FROM "expenses"
    UNION ALL SELECT 'supplier_invoice', "id", "currency", "amount_total" FROM "supplier_invoices"
    UNION ALL SELECT 'invoice', "id", "currency", "total_amount" FROM "invoices"
)
UPDATE "links" l
   SET "allocated_amount" = CASE WHEN l."currency" = e."currency" THEN l."allocated_amount" ELSE e.amt END,
       "currency"         = e."currency",
       "allocated_base"   = CASE WHEN l."currency" = e."currency"
                                 THEN round(abs(t."amount_base") * l."allocated_amount" / abs(t."amount"), 2)
                                 ELSE abs(t."amount_base") END
  FROM "bank_transactions" t, ent e
 WHERE l."kind" = 'justifies' AND l."from_type" = 'bank_transaction' AND l."from_id" = t."id"
   AND l."allocated_amount" IS NOT NULL AND e.t = l."to_type" AND e."id" = l."to_id";
-- the remainder rule: a row allocated in full (same currency) gives its base to the öre
WITH sums AS (
    SELECT l."from_id", sum(l."allocated_amount") AS amt, sum(l."allocated_base") AS base, max(l."created_at") AS last_at
      FROM "links" l JOIN "bank_transactions" t ON t."id" = l."from_id"
     WHERE l."kind" = 'justifies' AND l."from_type" = 'bank_transaction' AND l."allocated_amount" IS NOT NULL
       AND l."currency" = t."currency"
     GROUP BY l."from_id"
)
UPDATE "links" l
   SET "allocated_base" = l."allocated_base" + (abs(t."amount_base") - s.base)
  FROM sums s, "bank_transactions" t
 WHERE l."from_type" = 'bank_transaction' AND l."from_id" = s."from_id" AND t."id" = s."from_id"
   AND l."kind" = 'justifies' AND l."allocated_amount" IS NOT NULL AND l."created_at" = s.last_at
   AND s.amt = abs(t."amount") AND s.base <> abs(t."amount_base");

-- ----------------------------------------------------------------------------
-- 4. the entities' base at their date: a base the bank replaced (`rate_source = bank`) goes back to the ECB rate
--    of the entity's date (each leg the latest stored day within a week, as banking resolves it); a base-currency
--    entity is `same_currency`; where no rate is stored the realised base stays as a manual rate (base ÷ amount).
-- ----------------------------------------------------------------------------
CREATE FUNCTION pg_temp.ecb_leg(d date, ccy text) RETURNS TABLE ("rate_date" date, "rate" numeric) AS $$
    SELECT d, 1::numeric WHERE ccy = 'EUR'
    UNION ALL
    (SELECT r."date", r."rate" FROM "ecb_rates" r
      WHERE ccy <> 'EUR' AND r."currency_pair" = 'EUR/' || ccy AND r."date" <= d AND r."date" >= d - 7
      ORDER BY r."date" DESC LIMIT 1)
$$ LANGUAGE sql STABLE;
-- expenses
UPDATE "expenses" e
   SET "amount_base" = round(e."amount" * r."rate", 2), "rate" = r."rate", "rate_source" = r."src"::"rate_source", "rate_date" = r."rate_date"
  FROM (
    SELECT x."id",
           round(tb."rate" / tc."rate", 6) AS "rate",
           LEAST(tb."rate_date", tc."rate_date") AS "rate_date",
           CASE WHEN tb."rate_date" = x."date" AND tc."rate_date" = x."date" THEN 'ecb_daily' ELSE 'ecb_nearest' END AS "src"
      FROM "expenses" x
      JOIN "tenants" tn ON tn."id" = x."tenant_id"
      CROSS JOIN LATERAL pg_temp.ecb_leg(x."date", tn."currency") tb
      CROSS JOIN LATERAL pg_temp.ecb_leg(x."date", x."currency") tc
     WHERE x."rate_source" = 'bank' AND x."currency" <> tn."currency"
  ) r
 WHERE r."id" = e."id";
UPDATE "expenses" e SET "amount_base" = e."amount", "rate" = 1, "rate_source" = 'same_currency', "rate_date" = NULL
  FROM "tenants" tn WHERE tn."id" = e."tenant_id" AND e."rate_source" = 'bank' AND e."currency" = tn."currency";
-- supplier invoices
UPDATE "supplier_invoices" i
   SET "amount_base" = round(i."amount_total" * r."rate", 2), "rate" = r."rate", "rate_source" = r."src"::"rate_source", "rate_date" = r."rate_date"
  FROM (
    SELECT x."id",
           round(tb."rate" / tc."rate", 6) AS "rate",
           LEAST(tb."rate_date", tc."rate_date") AS "rate_date",
           CASE WHEN tb."rate_date" = x."invoice_date" AND tc."rate_date" = x."invoice_date" THEN 'ecb_daily' ELSE 'ecb_nearest' END AS "src"
      FROM "supplier_invoices" x
      JOIN "tenants" tn ON tn."id" = x."tenant_id"
      CROSS JOIN LATERAL pg_temp.ecb_leg(x."invoice_date", tn."currency") tb
      CROSS JOIN LATERAL pg_temp.ecb_leg(x."invoice_date", x."currency") tc
     WHERE x."rate_source" = 'bank' AND x."currency" <> tn."currency"
  ) r
 WHERE r."id" = i."id";
UPDATE "supplier_invoices" i SET "amount_base" = i."amount_total", "rate" = 1, "rate_source" = 'same_currency', "rate_date" = NULL
  FROM "tenants" tn WHERE tn."id" = i."tenant_id" AND i."rate_source" = 'bank' AND i."currency" = tn."currency";
DO $$
DECLARE
    kept_e int;
    kept_i int;
BEGIN
    UPDATE "expenses" SET "rate" = round("amount_base" / "amount", 6), "rate_source" = 'manual', "rate_date" = "date"
     WHERE "rate_source" = 'bank' AND "amount" <> 0;
    GET DIAGNOSTICS kept_e = ROW_COUNT;
    UPDATE "supplier_invoices" SET "rate" = round("amount_base" / "amount_total", 6), "rate_source" = 'manual', "rate_date" = "invoice_date"
     WHERE "rate_source" = 'bank' AND "amount_total" <> 0;
    GET DIAGNOSTICS kept_i = ROW_COUNT;
    RAISE NOTICE 'link_payment_record: % expense(s) and % supplier invoice(s) kept their realised base as a manual rate (no ECB rate stored for the day)', kept_e, kept_i;
END $$;
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_rate_source_check";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_rate_source_check" CHECK ("rate_source" <> 'bank');
ALTER TABLE "supplier_invoices" DROP CONSTRAINT IF EXISTS "supplier_invoices_rate_source_check";
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_rate_source_check" CHECK ("rate_source" <> 'bank');

-- ----------------------------------------------------------------------------
-- 5. settlements: the statement over the `settles` links of its row (US3). Each line of an ACTIVE settlement
--    becomes a link from the refund row to the expense (amount = the expense's amount pro rata of the line's base,
--    capped; base = the line's); the links that pointed at the settlement itself go; the lines and the derived
--    columns go; the audit trail says so.
-- ----------------------------------------------------------------------------
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tenant_id_bank_transaction_id_fkey"
    FOREIGN KEY ("tenant_id", "bank_transaction_id") REFERENCES "bank_transactions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE TEMP TABLE new_settle_links ("id" UUID PRIMARY KEY) ON COMMIT DROP;
WITH ins AS (
    INSERT INTO "links" ("tenant_id", "from_type", "from_id", "to_type", "to_id", "kind", "allocated_amount", "currency",
                         "allocated_base", "note", "created_at", "created_by", "source")
    SELECT sl."tenant_id", 'bank_transaction', s."bank_transaction_id", 'expense', sl."expense_id", 'settles',
           LEAST(e."amount", round(e."amount" * sl."allocated_base" / NULLIF(e."amount_base", 0), 2)), e."currency",
           sl."allocated_base", sl."note", sl."created_at", sl."created_by", 'migration'
      FROM "settlement_lines" sl
      JOIN "settlements" s ON s."id" = sl."settlement_id"
      JOIN "expenses" e ON e."id" = sl."expense_id"
     WHERE s."status" = 'active'
    RETURNING "id"
)
INSERT INTO new_settle_links SELECT "id" FROM ins;
INSERT INTO "audit_logs" ("tenant_id", "user_id", "action", "entity_type", "entity_id", "new_data", "source")
SELECT l."tenant_id", l."created_by", 'create', 'link', l."id"::text,
       jsonb_build_object('fromType', l."from_type", 'fromId', l."from_id", 'toType', l."to_type", 'toId', l."to_id",
                          'kind', l."kind", 'allocatedAmount', l."allocated_amount"::text, 'currency', l."currency",
                          'allocatedBase', l."allocated_base"::text, 'migration', 'link_payment_record'),
       'migration'
  FROM "links" l JOIN new_settle_links n ON n."id" = l."id";
INSERT INTO "audit_logs" ("tenant_id", "user_id", "action", "entity_type", "entity_id", "old_data", "source")
SELECT l."tenant_id", l."created_by", 'delete', 'link', l."id"::text,
       jsonb_build_object('fromType', l."from_type", 'fromId', l."from_id", 'toType', l."to_type", 'toId', l."to_id",
                          'kind', l."kind", 'allocatedAmount', l."allocated_amount"::text, 'currency', l."currency",
                          'migration', 'link_payment_record'),
       'migration'
  FROM "links" l WHERE l."kind" = 'settles' AND l."to_type" = 'settlement';
DELETE FROM "links" WHERE "kind" = 'settles' AND "to_type" = 'settlement';
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM new_settle_links;
    RAISE NOTICE 'link_payment_record: % settlement line(s) became settles links', n;
END $$;
DROP TABLE "settlement_lines";
ALTER TABLE "settlements"
    DROP COLUMN "payment_source_id",
    DROP COLUMN "refund_amount",
    DROP COLUMN "refund_currency",
    DROP COLUMN "refund_base",
    DROP COLUMN "allocated_base",
    DROP COLUMN "exchange_difference_base",
    DROP COLUMN "rounding_base",
    DROP COLUMN "exchange_difference_bas_code";
-- number, row and the PDF (once set) are written once; cancel changes status / cancelled_at; cancelled stays cancelled
CREATE OR REPLACE FUNCTION settlements_lock() RETURNS trigger AS $$
BEGIN
    IF NEW."number" IS DISTINCT FROM OLD."number"
       OR NEW."bank_transaction_id" IS DISTINCT FROM OLD."bank_transaction_id"
       OR (OLD."statement_document_id" IS NOT NULL AND NEW."statement_document_id" IS DISTINCT FROM OLD."statement_document_id")
       OR (OLD."status" = 'cancelled' AND NEW."status" IS DISTINCT FROM OLD."status")
    THEN
        RAISE EXCEPTION 'settlement_locked' USING ERRCODE = 'P0001',
            DETAIL = format('settlement %s: number, row and statement are written once', OLD."number");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER settlements_lock
    BEFORE UPDATE ON "settlements"
    FOR EACH ROW EXECUTE FUNCTION settlements_lock();

-- ----------------------------------------------------------------------------
-- 6. the duplicated payment columns and the parallel table go
-- ----------------------------------------------------------------------------
ALTER TABLE "expenses"
    DROP COLUMN "paid_amount",
    DROP COLUMN "paid_currency",
    DROP COLUMN "base_provisional",
    DROP COLUMN "payment_source_id";
ALTER TABLE "supplier_invoices"
    DROP COLUMN "paid_amount",
    DROP COLUMN "paid_currency";
ALTER TABLE "subscriptions" DROP COLUMN "payment_source_id";
DROP TABLE "payment_sources";
DROP TYPE "payment_source_kind";

-- ----------------------------------------------------------------------------
-- 7. the guard: every allocating link has a base, no entity is over-allocated, no row gives more than its base
-- ----------------------------------------------------------------------------
ALTER TABLE "links" ADD CONSTRAINT "links_allocation_pair_check"
    CHECK (("allocated_amount" IS NULL) = ("allocated_base" IS NULL));
DO $$
DECLARE
    bad text;
BEGIN
    WITH ent AS (
        SELECT 'expense'::text AS t, "id", "key" AS label, "amount" AS amt FROM "expenses"
        UNION ALL SELECT 'supplier_invoice', "id", "key", "amount_total" FROM "supplier_invoices"
        UNION ALL SELECT 'invoice', "id", "number", "total_amount" FROM "invoices"
    )
    SELECT string_agg(format('%s %s (%s > %s)', e.t, e.label, s.total, e.amt), '; ') INTO bad
      FROM (SELECT "to_type", "to_id", sum("allocated_amount") AS total FROM "links"
             WHERE "allocated_amount" IS NOT NULL GROUP BY "to_type", "to_id") s
      JOIN ent e ON e.t = s."to_type" AND e."id" = s."to_id"
     WHERE s.total > e.amt;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'link_payment_record: allocations exceed the amount — nothing changed: %', bad USING ERRCODE = 'P0001';
    END IF;
    SELECT string_agg(format('%s %s %s (base %s > %s)', t."booking_date", t."amount", t."currency", s.total, abs(t."amount_base")), '; ') INTO bad
      FROM (SELECT "from_id", sum("allocated_base") AS total FROM "links"
             WHERE "from_type" = 'bank_transaction' AND "allocated_base" IS NOT NULL GROUP BY "from_id") s
      JOIN "bank_transactions" t ON t."id" = s."from_id"
     WHERE s.total > abs(t."amount_base");
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'link_payment_record: a row gives more base than it has — nothing changed: %', bad USING ERRCODE = 'P0001';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 8. the invariants in Postgres (A1, A2): the allocation sums on every link, the money lock on both payables
-- ----------------------------------------------------------------------------
-- Σ allocated_amount onto an entity ≤ its amount (its own currency); Σ allocated_base from a bank row ≤ |its base|.
-- The target rows are locked FOR UPDATE first, so two concurrent allocations serialise and the second one sees the first.
CREATE OR REPLACE FUNCTION links_check_allocation() RETURNS trigger AS $$
DECLARE
    cap numeric;
    label text;
    total numeric;
    row_base numeric;
    row_label text;
BEGIN
    IF NEW."allocated_amount" IS NULL THEN
        RETURN NULL;
    END IF;
    IF NEW."to_type" = 'invoice' THEN
        SELECT "total_amount", "number" INTO cap, label FROM "invoices" WHERE "id" = NEW."to_id" FOR UPDATE;
    ELSIF NEW."to_type" = 'supplier_invoice' THEN
        SELECT "amount_total", "key" INTO cap, label FROM "supplier_invoices" WHERE "id" = NEW."to_id" FOR UPDATE;
    ELSIF NEW."to_type" = 'expense' THEN
        SELECT "amount", "key" INTO cap, label FROM "expenses" WHERE "id" = NEW."to_id" FOR UPDATE;
    END IF;
    IF cap IS NOT NULL THEN
        SELECT coalesce(sum("allocated_amount"), 0) INTO total FROM "links"
         WHERE "tenant_id" = NEW."tenant_id" AND "to_type" = NEW."to_type" AND "to_id" = NEW."to_id" AND "allocated_amount" IS NOT NULL;
        IF total > cap THEN
            RAISE EXCEPTION 'link_allocation_exceeded' USING ERRCODE = 'P0001',
                DETAIL = format('%s %s: allocations %s exceed its amount %s %s (remaining before this link: %s)',
                                replace(NEW."to_type", '_', ' '), label, total, cap, NEW."currency", cap - (total - NEW."allocated_amount"));
        END IF;
    END IF;
    IF NEW."from_type" = 'bank_transaction' THEN
        SELECT abs("amount_base"), format('%s %s %s', "booking_date", "amount", "currency") INTO row_base, row_label
          FROM "bank_transactions" WHERE "id" = NEW."from_id" FOR UPDATE;
        SELECT coalesce(sum("allocated_base"), 0) INTO total FROM "links"
         WHERE "tenant_id" = NEW."tenant_id" AND "from_type" = 'bank_transaction' AND "from_id" = NEW."from_id" AND "allocated_base" IS NOT NULL;
        IF total > row_base THEN
            RAISE EXCEPTION 'link_allocation_exceeded' USING ERRCODE = 'P0001',
                DETAIL = format('bank row %s: allocated base %s exceeds its base %s (remaining before this link: %s)',
                                row_label, total, row_base, row_base - (total - NEW."allocated_base"));
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER links_check_allocation
    AFTER INSERT ON "links"
    FOR EACH ROW EXECUTE FUNCTION links_check_allocation();

-- One lock for both payables (D37, A2, A13): the money facts and the payer are written once an allocating link
-- points at the row. Compared through jsonb so one function serves two row types; the key lock stays separate.
CREATE OR REPLACE FUNCTION lock_money_when_linked() RETURNS trigger AS $$
DECLARE
    linkable text := CASE TG_TABLE_NAME WHEN 'expenses' THEN 'expense' ELSE 'supplier_invoice' END;
    locked text[] := CASE TG_TABLE_NAME
        WHEN 'expenses' THEN ARRAY['amount', 'currency', 'vat_amount', 'date', 'amount_base', 'rate', 'rate_source', 'rate_date', 'paid_from_account_id', 'group_id']
        ELSE ARRAY['amount_net', 'vat_amount', 'amount_total', 'currency', 'invoice_date', 'amount_base', 'rate', 'rate_source', 'rate_date', 'group_id'] END;
    o jsonb := to_jsonb(OLD);
    n jsonb := to_jsonb(NEW);
    k text;
BEGIN
    FOREACH k IN ARRAY locked LOOP
        IF n -> k IS DISTINCT FROM o -> k THEN
            IF EXISTS (SELECT 1 FROM "links" l
                        WHERE l."tenant_id" = (o ->> 'tenant_id')::uuid AND l."to_type" = linkable
                          AND l."to_id" = (o ->> 'id')::uuid AND l."allocated_amount" IS NOT NULL) THEN
                RAISE EXCEPTION USING MESSAGE = linkable || '_locked', ERRCODE = 'P0001',
                    DETAIL = format('%s %s is paid: its money facts are written once (%s)', replace(linkable, '_', ' '), o ->> 'key', k);
            END IF;
            EXIT;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER expenses_lock_money_when_linked
    BEFORE UPDATE ON "expenses"
    FOR EACH ROW EXECUTE FUNCTION lock_money_when_linked();
CREATE TRIGGER supplier_invoices_lock_money_when_linked
    BEFORE UPDATE ON "supplier_invoices"
    FOR EACH ROW EXECUTE FUNCTION lock_money_when_linked();
-- the expense's key is assigned once (the part of the old trigger that was not about money)
CREATE OR REPLACE FUNCTION expenses_lock_key() RETURNS trigger AS $$
BEGIN
    IF NEW."key" IS DISTINCT FROM OLD."key" OR NEW."seq" IS DISTINCT FROM OLD."seq" OR NEW."alias" IS DISTINCT FROM OLD."alias" THEN
        RAISE EXCEPTION 'expense_locked' USING ERRCODE = 'P0001',
            DETAIL = format('expense %s: the key is assigned once', OLD."key");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER expenses_lock_key
    BEFORE UPDATE ON "expenses"
    FOR EACH ROW EXECUTE FUNCTION expenses_lock_key();
