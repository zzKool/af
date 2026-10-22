-- Expenses + traktamente (D26, D27, D28, D29; specs/expenses/spec.md, specs/traktamente/spec.md).
-- expense_groups (the folder a receipt goes into), payment_sources (AF SEK / AF CHF / Private SE / Private CH),
-- expenses (one cost: key Ex213-Tr-01, SEK base, who paid), settlements + settlement_lines (one refund transaction
-- settling private expenses in SEK base), normalbelopp (Skatteverket's day amounts per year and country),
-- trips (the trip of a trip group, meals as counts, the computed breakdown).

-- ============================================================================
-- enums
-- ============================================================================
CREATE TYPE "expense_group_kind" AS ENUM ('trip', 'batch');
CREATE TYPE "payment_source_kind" AS ENUM ('bank_account', 'private');
CREATE TYPE "expense_kind" AS ENUM ('receipt', 'per_diem', 'vat_payment');
CREATE TYPE "settlement_status" AS ENUM ('active', 'cancelled');

-- ============================================================================
-- expense_groups
-- ============================================================================
CREATE TABLE "expense_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "kind" "expense_group_kind" NOT NULL DEFAULT 'batch',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "expense_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expense_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expense_groups_number_check" CHECK ("number" > 0),
    CONSTRAINT "expense_groups_description_check" CHECK (length(btrim("description")) > 0)
);
CREATE UNIQUE INDEX "expense_groups_tenant_number_key" ON "expense_groups"("tenant_id", "number");

-- ============================================================================
-- payment_sources
-- ============================================================================
CREATE TABLE "payment_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "kind" "payment_source_kind" NOT NULL,
    "bank_account_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "owner_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "payment_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payment_sources_kind_account_check" CHECK (("kind" = 'bank_account') = ("bank_account_id" IS NOT NULL)),
    CONSTRAINT "payment_sources_currency_upper_check" CHECK ("currency" = upper("currency"))
);
CREATE UNIQUE INDEX "payment_sources_tenant_label_key" ON "payment_sources"("tenant_id", "label");

-- ============================================================================
-- expenses
-- ============================================================================
CREATE TABLE "expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "key" VARCHAR(30) NOT NULL,
    "seq" INTEGER NOT NULL,
    "alias" VARCHAR(6) NOT NULL,
    "kind" "expense_kind" NOT NULL DEFAULT 'receipt',
    "date" DATE NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "bas_code" VARCHAR(4) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "vat_amount" DECIMAL(15,2),
    "vat_registration_id" UUID,
    "amount_base" DECIMAL(15,2) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "rate_source" VARCHAR(20) NOT NULL,
    "rate_date" DATE,
    "base_provisional" BOOLEAN NOT NULL DEFAULT false,
    "paid_amount" DECIMAL(15,2),
    "paid_currency" CHAR(3),
    "payment_source_id" UUID NOT NULL,
    "document_missing" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expenses_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "expense_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "expenses_payment_source_id_fkey" FOREIGN KEY ("payment_source_id") REFERENCES "payment_sources"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "expenses_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "expenses_vat_amount_check" CHECK ("vat_amount" IS NULL OR "vat_amount" >= 0),
    CONSTRAINT "expenses_rate_positive_check" CHECK ("rate" > 0),
    CONSTRAINT "expenses_seq_check" CHECK ("seq" > 0),
    CONSTRAINT "expenses_currency_upper_check" CHECK ("currency" = upper("currency")),
    CONSTRAINT "expenses_paid_pair_check" CHECK (("paid_amount" IS NULL) = ("paid_currency" IS NULL)),
    CONSTRAINT "expenses_paid_amount_positive_check" CHECK ("paid_amount" IS NULL OR "paid_amount" > 0),
    CONSTRAINT "expenses_rate_source_check" CHECK ("rate_source" IN ('same_currency', 'ecb_daily', 'ecb_nearest', 'bank', 'manual'))
);
CREATE UNIQUE INDEX "expenses_tenant_key_key" ON "expenses"("tenant_id", "key");
CREATE UNIQUE INDEX "expenses_group_alias_seq_key" ON "expenses"("group_id", "alias", "seq");
CREATE INDEX "expenses_tenant_id_date_idx" ON "expenses"("tenant_id", "date" DESC);
CREATE INDEX "expenses_tenant_id_group_id_idx" ON "expenses"("tenant_id", "group_id");
CREATE INDEX "expenses_tenant_id_payment_source_id_idx" ON "expenses"("tenant_id", "payment_source_id");
CREATE INDEX "expenses_tenant_id_bas_code_idx" ON "expenses"("tenant_id", "bas_code");

CREATE TRIGGER expenses_block_delete_when_linked
    BEFORE DELETE ON "expenses"
    FOR EACH ROW EXECUTE FUNCTION block_delete_when_linked('expense');

-- ============================================================================
-- settlements + settlement_lines
-- ============================================================================
CREATE TABLE "settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "bank_transaction_id" UUID NOT NULL,
    "payment_source_id" UUID NOT NULL,
    "refund_amount" DECIMAL(15,2) NOT NULL,
    "refund_currency" CHAR(3) NOT NULL,
    "refund_base" DECIMAL(15,2) NOT NULL,
    "allocated_base" DECIMAL(15,2) NOT NULL,
    "exchange_difference_base" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "rounding_base" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "exchange_difference_bas_code" VARCHAR(4),
    "note" TEXT,
    "status" "settlement_status" NOT NULL DEFAULT 'active',
    "cancelled_at" TIMESTAMPTZ,
    "statement_document_id" UUID,
    "statement_superseded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "settlements_payment_source_id_fkey" FOREIGN KEY ("payment_source_id") REFERENCES "payment_sources"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "settlements_refund_base_check" CHECK ("refund_base" > 0),
    CONSTRAINT "settlements_allocated_base_check" CHECK ("allocated_base" > 0),
    CONSTRAINT "settlements_refund_currency_upper_check" CHECK ("refund_currency" = upper("refund_currency")),
    CONSTRAINT "settlements_cancelled_check" CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "settlements_tenant_number_key" ON "settlements"("tenant_id", "number");
CREATE UNIQUE INDEX "settlements_active_transaction_key" ON "settlements"("bank_transaction_id") WHERE "status" = 'active';
CREATE INDEX "settlements_tenant_id_bank_transaction_id_idx" ON "settlements"("tenant_id", "bank_transaction_id");
CREATE INDEX "settlements_tenant_id_status_idx" ON "settlements"("tenant_id", "status");

CREATE TABLE "settlement_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "allocated_base" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlement_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "settlement_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "settlement_lines_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "settlement_lines_allocated_base_check" CHECK ("allocated_base" > 0)
);
CREATE UNIQUE INDEX "settlement_lines_settlement_expense_key" ON "settlement_lines"("settlement_id", "expense_id");
CREATE INDEX "settlement_lines_tenant_id_expense_id_idx" ON "settlement_lines"("tenant_id", "expense_id");

-- The money facts of an expense are written once it is settled (constitution §1): a settlement line references it.
-- Description, category, note, document_missing, vat_* change freely. (While open, the service recomputes the base.)
CREATE OR REPLACE FUNCTION expenses_lock_when_settled() RETURNS trigger AS $$
BEGIN
    IF (NEW."amount" IS DISTINCT FROM OLD."amount"
        OR NEW."currency" IS DISTINCT FROM OLD."currency"
        OR NEW."date" IS DISTINCT FROM OLD."date"
        OR NEW."amount_base" IS DISTINCT FROM OLD."amount_base"
        OR NEW."rate" IS DISTINCT FROM OLD."rate"
        OR NEW."rate_source" IS DISTINCT FROM OLD."rate_source"
        OR NEW."rate_date" IS DISTINCT FROM OLD."rate_date"
        OR NEW."paid_amount" IS DISTINCT FROM OLD."paid_amount"
        OR NEW."paid_currency" IS DISTINCT FROM OLD."paid_currency"
        OR NEW."payment_source_id" IS DISTINCT FROM OLD."payment_source_id"
        OR NEW."group_id" IS DISTINCT FROM OLD."group_id"
        OR NEW."key" IS DISTINCT FROM OLD."key")
       AND EXISTS (SELECT 1 FROM "settlement_lines" sl WHERE sl."expense_id" = OLD."id")
    THEN
        RAISE EXCEPTION 'expense_locked' USING ERRCODE = 'P0001',
            DETAIL = format('expense %s is settled: its money facts are written once', OLD."key");
    END IF;
    IF NEW."key" IS DISTINCT FROM OLD."key" OR NEW."seq" IS DISTINCT FROM OLD."seq" OR NEW."alias" IS DISTINCT FROM OLD."alias" THEN
        RAISE EXCEPTION 'expense_locked' USING ERRCODE = 'P0001',
            DETAIL = format('expense %s: the key is assigned once', OLD."key");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER expenses_lock_when_settled
    BEFORE UPDATE ON "expenses"
    FOR EACH ROW EXECUTE FUNCTION expenses_lock_when_settled();

-- A settlement's money is written once; cancel changes status / cancelled_at / statement_superseded; the job sets
-- statement_document_id once (NULL → value).
CREATE OR REPLACE FUNCTION settlements_lock() RETURNS trigger AS $$
BEGIN
    IF NEW."number" IS DISTINCT FROM OLD."number"
       OR NEW."bank_transaction_id" IS DISTINCT FROM OLD."bank_transaction_id"
       OR NEW."payment_source_id" IS DISTINCT FROM OLD."payment_source_id"
       OR NEW."refund_amount" IS DISTINCT FROM OLD."refund_amount"
       OR NEW."refund_currency" IS DISTINCT FROM OLD."refund_currency"
       OR NEW."refund_base" IS DISTINCT FROM OLD."refund_base"
       OR NEW."allocated_base" IS DISTINCT FROM OLD."allocated_base"
       OR NEW."exchange_difference_base" IS DISTINCT FROM OLD."exchange_difference_base"
       OR NEW."rounding_base" IS DISTINCT FROM OLD."rounding_base"
       OR (OLD."statement_document_id" IS NOT NULL AND NEW."statement_document_id" IS DISTINCT FROM OLD."statement_document_id")
       OR (OLD."status" = 'cancelled' AND NEW."status" IS DISTINCT FROM OLD."status")
    THEN
        RAISE EXCEPTION 'settlement_locked' USING ERRCODE = 'P0001',
            DETAIL = format('settlement %s: money facts are written once', OLD."number");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER settlements_lock
    BEFORE UPDATE ON "settlements"
    FOR EACH ROW EXECUTE FUNCTION settlements_lock();

CREATE TRIGGER settlements_block_delete_when_linked
    BEFORE DELETE ON "settlements"
    FOR EACH ROW EXECUTE FUNCTION block_delete_when_linked('settlement');

-- ============================================================================
-- normalbelopp + trips
-- ============================================================================
CREATE TABLE "normalbelopp" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "country_name_sv" VARCHAR(100) NOT NULL,
    "country_name_en" VARCHAR(100),
    "day_amount" DECIMAL(10,2) NOT NULL,
    "night_amount" DECIMAL(10,2),
    "meal_breakfast" DECIMAL(10,2),
    "meal_lunch" DECIMAL(10,2),
    "meal_dinner" DECIMAL(10,2),
    "meal_all" DECIMAL(10,2),
    "rate_source" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "normalbelopp_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "normalbelopp_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "normalbelopp_year_check" CHECK ("year" BETWEEN 2000 AND 2100),
    CONSTRAINT "normalbelopp_country_upper_check" CHECK ("country_code" = upper("country_code")),
    CONSTRAINT "normalbelopp_day_amount_check" CHECK ("day_amount" > 0),
    CONSTRAINT "normalbelopp_night_amount_check" CHECK ("night_amount" IS NULL OR "night_amount" >= 0)
);
CREATE UNIQUE INDEX "normalbelopp_tenant_year_country_key" ON "normalbelopp"("tenant_id", "year", "country_code");

CREATE TABLE "trips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "departure_at" TIMESTAMPTZ NOT NULL,
    "return_at" TIMESTAMPTZ NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "agency" VARCHAR(100),
    "breakfasts" INTEGER NOT NULL DEFAULT 0,
    "lunches" INTEGER NOT NULL DEFAULT 0,
    "dinners" INTEGER NOT NULL DEFAULT 0,
    "nights_without_paid_lodging" INTEGER NOT NULL DEFAULT 0,
    "long_stay_factor" DECIMAL(3,2),
    "computed" JSONB,
    "per_diem_expense_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trips_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "trips_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "expense_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "trips_dates_check" CHECK ("return_at" > "departure_at"),
    CONSTRAINT "trips_counts_check" CHECK ("breakfasts" >= 0 AND "lunches" >= 0 AND "dinners" >= 0 AND "nights_without_paid_lodging" >= 0),
    CONSTRAINT "trips_long_stay_check" CHECK ("long_stay_factor" IS NULL OR ("long_stay_factor" > 0 AND "long_stay_factor" <= 1)),
    CONSTRAINT "trips_country_upper_check" CHECK ("country_code" = upper("country_code"))
);
CREATE UNIQUE INDEX "trips_group_id_key" ON "trips"("group_id");
CREATE INDEX "trips_tenant_id_country_code_idx" ON "trips"("tenant_id", "country_code");

-- ============================================================================
-- RLS + grants
-- ============================================================================
ALTER TABLE "expense_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense_groups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "expense_groups"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "expense_groups" TO af_app;

ALTER TABLE "payment_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_sources"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "payment_sources" TO af_app;

ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "expenses"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "expenses" TO af_app;

ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "settlements"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
-- no DELETE grant: a settlement is cancelled, never deleted (its number and statement stay)
GRANT SELECT, INSERT, UPDATE ON TABLE "settlements" TO af_app;

ALTER TABLE "settlement_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlement_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "settlement_lines"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "settlement_lines" TO af_app;

ALTER TABLE "normalbelopp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "normalbelopp" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "normalbelopp"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "normalbelopp" TO af_app;

ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trips" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "trips"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "trips" TO af_app;
