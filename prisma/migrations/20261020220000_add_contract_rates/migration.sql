-- Contract rate history (D24, specs/contracts/spec.md). A contract has dated, non-overlapping rates;
-- the rate for an invoice period is the one valid on period_start; contracts.billing_rate is derived
-- from the history (rate valid today) and therefore dropped after being carried over.

-- daterange exclusion needs btree_gist for the `contract_id WITH =` part. Contrib module of the official image.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- One value today (D24). Adding a unit: ALTER TYPE rate_unit ADD VALUE 'hour'; + a label in the dictionaries.
CREATE TYPE "rate_unit" AS ENUM ('day');

CREATE TABLE "contract_rates" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "valid_from"  DATE NOT NULL,
    "valid_to"    DATE,
    "rate"        DECIMAL(15,2) NOT NULL,
    "unit"        "rate_unit" NOT NULL DEFAULT 'day',
    "note"        VARCHAR(500),
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"  TIMESTAMPTZ NOT NULL,
    "created_by"  UUID NOT NULL,
    "source"      VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "contract_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contract_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- intra-module FK (same module, same tenant): a contract with rates is never deleted (v2 soft-deletes anyway)
    CONSTRAINT "contract_rates_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contract_rates_rate_positive_check" CHECK ("rate" > 0),
    CONSTRAINT "contract_rates_valid_range_check" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from"),
    -- the invariant: rates of one contract never overlap, both bounds inclusive, open end = infinity.
    -- Holds under concurrency regardless of the service pre-check (SQLSTATE 23P01 when violated).
    CONSTRAINT "contract_rates_no_overlap" EXCLUDE USING gist (
        "contract_id" WITH =,
        daterange("valid_from", "valid_to", '[]') WITH &&
    )
);

CREATE INDEX "idx_contract_rates_contract_valid_from" ON "contract_rates"("tenant_id", "contract_id", "valid_from" DESC);

ALTER TABLE "contract_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contract_rates"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "contract_rates" TO defterfab_app;

-- Carry-over (spec FR-010): every contract that had a typed billing rate gets one open rate from its start date.
INSERT INTO "contract_rates" ("tenant_id", "contract_id", "valid_from", "valid_to", "rate", "unit", "note", "updated_at", "created_by", "source")
SELECT "tenant_id", "id", "start_date", NULL, "billing_rate", 'day', 'carried over from the contract''s billing rate', NOW(), "created_by", 'migration'
FROM "contracts"
WHERE "billing_rate" IS NOT NULL AND "billing_rate" > 0;

ALTER TABLE "contracts" DROP COLUMN "billing_rate";
