-- Swiss VAT declarations (D23; specs/exports/spec.md): the minimal record per CH registration and quarter — the
-- manual refs of the FTA form, the figures as declared, declared on / paid on, the vat_payment expense (validated UUID).

CREATE TABLE "swiss_vat_declarations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vat_registration_id" UUID NOT NULL,
    "period" VARCHAR(12) NOT NULL,
    "manual" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB,
    "declared_at" DATE,
    "paid_at" DATE,
    "payment_expense_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "swiss_vat_declarations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "swiss_vat_declarations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "swiss_vat_declarations_period_check" CHECK ("period" ~ '^CH [0-9]{4}/Q[1-4]$'),
    CONSTRAINT "swiss_vat_declarations_paid_check" CHECK ("paid_at" IS NULL OR "declared_at" IS NOT NULL)
);
CREATE UNIQUE INDEX "swiss_vat_declarations_tenant_registration_period_key" ON "swiss_vat_declarations"("tenant_id", "vat_registration_id", "period");
CREATE INDEX "swiss_vat_declarations_tenant_period_idx" ON "swiss_vat_declarations"("tenant_id", "period");

ALTER TABLE "swiss_vat_declarations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "swiss_vat_declarations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "swiss_vat_declarations"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "swiss_vat_declarations" TO af_app;
