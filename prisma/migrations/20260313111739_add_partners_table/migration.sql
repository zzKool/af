-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "org_number" TEXT,
    "vat_number" TEXT,
    "types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_currency" TEXT,
    "default_language" TEXT,
    "default_bas_category_code" TEXT,
    "external_identifiers" JSONB NOT NULL DEFAULT '[]',
    "email" TEXT,
    "phone" TEXT,
    "address" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_default_bas_category_code_fkey" FOREIGN KEY ("default_bas_category_code") REFERENCES "bas_categories"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS
ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partners" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "partners" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "partners" TO defterfab_app;

-- Unique constraint: one org_number per tenant (when not null)
CREATE UNIQUE INDEX idx_partners_tenant_org ON "partners" ("tenant_id", "org_number") WHERE "org_number" IS NOT NULL;
