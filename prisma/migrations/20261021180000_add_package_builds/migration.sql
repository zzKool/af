-- Accountant package builds (D13, D17, D31; specs/accountant-package/spec.md): one row per build of a period
-- (`2026-06` or `2026`), versioned per period; the zip is a generated document (validated UUID).

CREATE TYPE "package_build_status" AS ENUM ('queued', 'building', 'built', 'failed');

CREATE TABLE "package_builds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "package_build_status" NOT NULL DEFAULT 'queued',
    "document_id" UUID,
    "business_key" VARCHAR(100) NOT NULL,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "flags" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "error" TEXT,
    "built_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "package_builds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "package_builds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "package_builds_period_check" CHECK ("period" ~ '^[0-9]{4}(-[0-9]{2})?$'),
    CONSTRAINT "package_builds_version_check" CHECK ("version" > 0),
    CONSTRAINT "package_builds_built_check" CHECK ("status" <> 'built' OR ("document_id" IS NOT NULL AND "built_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "package_builds_tenant_period_version_key" ON "package_builds"("tenant_id", "period", "version");
CREATE INDEX "package_builds_tenant_period_idx" ON "package_builds"("tenant_id", "period");

ALTER TABLE "package_builds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "package_builds" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "package_builds"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "package_builds" TO defterfab_app;
