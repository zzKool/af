-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "business_key" VARCHAR(100) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "blob_url" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "prefix_type" VARCHAR(30) NOT NULL,
    "document_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'uploaded',
    "ocr_data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_documents_tenant_status" ON "documents"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "idx_documents_tenant_business_key" ON "documents"("tenant_id", "business_key");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "documents"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "documents" TO defterfab_app;

-- Counter Table for Business Key Sequences
CREATE TABLE "document_key_counters" (
    "tenant_id" UUID NOT NULL,
    "year_month" CHAR(7) NOT NULL,
    "next_val" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_key_counters_pkey" PRIMARY KEY ("tenant_id", "year_month")
);

-- RLS for counter table
ALTER TABLE "document_key_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_key_counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_key_counters"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON TABLE "document_key_counters" TO defterfab_app;
