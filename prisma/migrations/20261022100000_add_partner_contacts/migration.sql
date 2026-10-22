-- Contact persons on a partner (F08, specs/partners/spec.md). Additive: a new table, nothing changed elsewhere.

CREATE TABLE "partner_contacts" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"  UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "name"       VARCHAR(200) NOT NULL,
    "role"       VARCHAR(100),
    "email"      VARCHAR(254),
    "phone"      VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source"     VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "partner_contacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "partner_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- intra-module FK (same module, same tenant): a contact never outlives its partner
    CONSTRAINT "partner_contacts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_partner_contacts_tenant_partner" ON "partner_contacts"("tenant_id", "partner_id");

ALTER TABLE "partner_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "partner_contacts"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "partner_contacts" TO defterfab_app;
