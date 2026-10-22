-- ─────────────────────────────────────────────────────────────
-- VAT Registrations — per-tenant multi-country VAT management
-- ─────────────────────────────────────────────────────────────
--
-- vat_registrations: Stores a tenant's VAT registrations across multiple countries.
--   - Each row represents one country registration (e.g., Swedish moms, Swiss MWST).
--   - rate_schedule: JSONB field storing an array of applicable VAT rates for that country.
--     Example: { "rates": [25, 12, 6] } for Swedish moms standard/reduced/super-reduced.
--   - Rates are percentage numbers (not Decimals) — used for selection convenience,
--     NOT as source of truth for applied rates. Journal entries (Epic 6) will snapshot
--     the applied rate per entry.
--   - Full RLS with tenant isolation policy.
--   - Follows mandatory template (id, tenantId, createdAt, updatedAt, createdBy, source).
--
-- Downstream consumers (not yet implemented):
--   - Epic 4: Contract VAT rules reference tenant's registrations
--   - Epic 10: Invoice generation uses VAT rates from registrations
--   - Declaration exports: Momsdeklaration filtering by registration
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "vat_registrations" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "country" VARCHAR(2) NOT NULL,
    "vat_number" VARCHAR(50) NOT NULL,
    "rate_schedule" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web'
);

-- Unique constraint: one VAT number per country per tenant
-- Allows multiple registrations per country (different VAT numbers for different activities)
ALTER TABLE "vat_registrations"
    ADD CONSTRAINT "vat_registrations_tenant_id_country_vat_number_key"
    UNIQUE ("tenant_id", "country", "vat_number");

-- Tenant isolation index — explicit for query optimization (RLS scans by tenant_id)
CREATE INDEX "vat_registrations_tenant_id_idx" ON "vat_registrations" ("tenant_id");

-- Foreign key to tenants
ALTER TABLE "vat_registrations"
    ADD CONSTRAINT "vat_registrations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- RLS: Tenant isolation
-- ─────────────────────────────────────────────────────────────

ALTER TABLE vat_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vat_registrations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON vat_registrations
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────
-- Grants: Full CRUD for app role
-- ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE vat_registrations TO af_app;
