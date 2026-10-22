-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "partner_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "assigned_employee_id" UUID,
    "billing_rate" DECIMAL(15,2),
    "currency" TEXT,
    "payment_terms" TEXT,
    "vat_registration_id" UUID,
    "external_references" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contracts_tenant_id_partner_id_idx" ON "contracts"("tenant_id", "partner_id");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_assigned_employee_id_fkey" FOREIGN KEY ("assigned_employee_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_vat_registration_id_fkey" FOREIGN KEY ("vat_registration_id") REFERENCES "vat_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS
ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contracts" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "contracts" TO af_app;
