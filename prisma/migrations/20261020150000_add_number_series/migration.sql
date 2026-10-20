-- number_series: gap-free counters per (tenant, series) — D5/D6. Replaces document_key_counters and
-- the configurable document_type_prefixes (those two tables are dropped in a later, separately
-- approved migration; their current counters are carried over below so no key is ever reused).
CREATE TABLE "number_series" (
    "tenant_id"  UUID NOT NULL,
    "series"     VARCHAR(40) NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("tenant_id", "series"),
    CONSTRAINT "number_series_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "number_series_next_value_check" CHECK ("next_value" >= 1)
);

ALTER TABLE "number_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "number_series" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "number_series"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON TABLE "number_series" TO defterfab_app;

-- Carry the monthly upload counters over: document_key_counters.next_val is the LAST value handed out
-- (it is incremented on read), number_series.next_value is the NEXT one.
INSERT INTO "number_series" ("tenant_id", "series", "next_value")
SELECT "tenant_id", 'doc-' || "year_month", "next_val" + 1
FROM "document_key_counters"
ON CONFLICT DO NOTHING;
