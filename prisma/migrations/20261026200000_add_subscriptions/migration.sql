-- F94 (D57, specs/subscriptions): subscriptions — a recurring cost described once. Expectations only: no
-- money fact of record lives here (every amount, base and rate is written by the expense / supplier invoice a
-- confirm creates). Periods and their state are read models, never stored. Additive only.
-- References: partner, payment source and VAT registration are validated UUIDs through their modules
-- (constitution §2); the group is a real FK into the shared reference expense_groups (D38).

CREATE TYPE "subscription_becomes" AS ENUM ('expense', 'supplier_invoice');
CREATE TYPE "subscription_cadence" AS ENUM ('monthly', 'yearly');

CREATE TABLE "subscriptions" (
    "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"           UUID NOT NULL,
    "name"                VARCHAR(120) NOT NULL,
    "partner_id"          UUID NOT NULL,
    "becomes"             "subscription_becomes" NOT NULL,
    "bas_code"            VARCHAR(4) NOT NULL,
    "group_id"            UUID NOT NULL,
    "payment_source_id"   UUID NOT NULL,
    "vat_registration_id" UUID,
    "cadence"             "subscription_cadence" NOT NULL,
    "start_date"          DATE NOT NULL,
    "end_date"            DATE,
    "match_text"          VARCHAR(100),
    "tolerance_pct"       DECIMAL(5,2) NOT NULL DEFAULT 5,
    "note"                VARCHAR(500),
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ NOT NULL,
    "created_by"          UUID NOT NULL,
    "source"              VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subscriptions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "expense_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "subscriptions_tolerance_check" CHECK ("tolerance_pct" >= 0 AND "tolerance_pct" <= 50),
    CONSTRAINT "subscriptions_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
    CONSTRAINT "subscriptions_name_check" CHECK (length(btrim("name")) > 0)
);

CREATE UNIQUE INDEX "subscriptions_tenant_name_key" ON "subscriptions"("tenant_id", "name");
CREATE INDEX "subscriptions_tenant_id_partner_id_idx" ON "subscriptions"("tenant_id", "partner_id");

CREATE TABLE "subscription_prices" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"       UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "valid_from"      DATE NOT NULL,
    "valid_to"        DATE,
    "amount"          DECIMAL(15,2) NOT NULL,
    "currency"        CHAR(3) NOT NULL,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ NOT NULL,
    "created_by"      UUID NOT NULL,
    "source"          VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "subscription_prices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscription_prices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subscription_prices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subscription_prices_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "subscription_prices_valid_range_check" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from"),
    -- the contract-rate invariant (D24's shape): prices of one subscription never overlap, both bounds
    -- inclusive, open end = infinity. btree_gist is installed by 20261020220000_add_contract_rates.
    CONSTRAINT "subscription_prices_no_overlap" EXCLUDE USING gist (
        "subscription_id" WITH =,
        daterange("valid_from", "valid_to", '[]') WITH &&
    )
);

CREATE INDEX "idx_subscription_prices_valid_from" ON "subscription_prices"("tenant_id", "subscription_id", "valid_from" DESC);

CREATE TABLE "subscription_pauses" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"       UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "from_date"       DATE NOT NULL,
    "to_date"         DATE NOT NULL,
    "note"            VARCHAR(500) NOT NULL,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      UUID NOT NULL,
    "source"          VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "subscription_pauses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscription_pauses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subscription_pauses_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subscription_pauses_range_check" CHECK ("to_date" >= "from_date"),
    CONSTRAINT "subscription_pauses_note_check" CHECK (length(btrim("note")) > 0)
);

CREATE INDEX "subscription_pauses_tenant_id_subscription_id_idx" ON "subscription_pauses"("tenant_id", "subscription_id");

-- RLS, like every tenant table
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subscriptions"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "subscriptions" TO af_app;

ALTER TABLE "subscription_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_prices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subscription_prices"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "subscription_prices" TO af_app;

ALTER TABLE "subscription_pauses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_pauses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subscription_pauses"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "subscription_pauses" TO af_app;

-- The attribution link (FR-005): an expense / supplier invoice (from) is an occurrence of a subscription (to).
-- An entity is the period of at most one subscription — enforced here, independent of the service.
ALTER TABLE "links" DROP CONSTRAINT "links_kind_check";
ALTER TABLE "links" ADD CONSTRAINT "links_kind_check"
    CHECK ("kind" IN ('justifies', 'transfer', 'settles', 'belongs_to', 'created_from', 'occurrence_of'));

CREATE UNIQUE INDEX "links_occurrence_of_entity_key"
    ON "links"("tenant_id", "from_type", "from_id") WHERE "kind" = 'occurrence_of';
