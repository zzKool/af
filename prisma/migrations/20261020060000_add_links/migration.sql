-- Module linking: the single link table (constitution §2, D18)
-- Polymorphic endpoints (type + id), no cross-table FKs. Only src/modules/linking writes this table.

CREATE TABLE "links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "from_type" VARCHAR(40) NOT NULL,
    "from_id" UUID NOT NULL,
    "to_type" VARCHAR(40) NOT NULL,
    "to_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "allocated_amount" DECIMAL(15,2),
    "currency" VARCHAR(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "links_kind_check" CHECK ("kind" IN ('justifies', 'transfer', 'settles', 'belongs_to')),
    CONSTRAINT "links_allocation_positive_check" CHECK ("allocated_amount" IS NULL OR "allocated_amount" > 0),
    CONSTRAINT "links_allocation_currency_check" CHECK (("allocated_amount" IS NULL) = ("currency" IS NULL)),
    CONSTRAINT "links_not_self_check" CHECK (NOT ("from_type" = "to_type" AND "from_id" = "to_id"))
);

ALTER TABLE "links" ADD CONSTRAINT "links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "links_tenant_endpoints_kind_key" ON "links"("tenant_id", "from_type", "from_id", "to_type", "to_id", "kind");
CREATE INDEX "idx_links_from" ON "links"("tenant_id", "from_type", "from_id");
CREATE INDEX "idx_links_to" ON "links"("tenant_id", "to_type", "to_id");

-- RLS
ALTER TABLE "links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "links"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, DELETE ON TABLE "links" TO af_app;

-- Invariant (constitution §2): a linked document cannot be hard-deleted. Enforced in the database,
-- independent of the service layer. The service translates SQLSTATE P0001 / 'document_linked' into
-- a BUSINESS_RULE_VIOLATION.
CREATE OR REPLACE FUNCTION block_delete_when_linked() RETURNS trigger AS $$
DECLARE
    entity_type TEXT := TG_ARGV[0];
BEGIN
    IF EXISTS (
        SELECT 1 FROM "links" l
        WHERE (l."from_type" = entity_type AND l."from_id" = OLD."id")
           OR (l."to_type" = entity_type AND l."to_id" = OLD."id")
    ) THEN
        RAISE EXCEPTION 'document_linked' USING ERRCODE = 'P0001',
            DETAIL = format('%s %s is linked and cannot be deleted', entity_type, OLD."id");
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_block_delete_when_linked
    BEFORE DELETE ON "documents"
    FOR EACH ROW EXECUTE FUNCTION block_delete_when_linked('document');
