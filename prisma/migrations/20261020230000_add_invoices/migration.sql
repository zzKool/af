-- Invoices: quotes, invoices and credit notes on one table (D7, D21, D22; specs/invoices/spec.md).
-- Typed states are hand-set facts; paid / overdue / credited / expired / converted are derived.
-- Issued documents are immutable (triggers below). Cross-module references are validated UUIDs, no FKs.

CREATE TYPE "invoice_type" AS ENUM ('quote', 'invoice', 'credit_note');
CREATE TYPE "invoice_status" AS ENUM ('draft', 'issued', 'sent', 'accepted', 'declined');

CREATE TABLE "invoices" (
    "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"           UUID NOT NULL,
    "type"                "invoice_type" NOT NULL,
    "status"              "invoice_status" NOT NULL DEFAULT 'draft',
    "number"              VARCHAR(30),
    "partner_id"          UUID NOT NULL,
    "contract_id"         UUID,
    "vat_registration_id" UUID,
    "related_invoice_id"  UUID,
    "issue_date"          DATE NOT NULL,
    "due_date"            DATE,
    "period_label"        VARCHAR(100),
    "period_start"        DATE,
    "period_end"          DATE,
    "currency"            CHAR(3) NOT NULL,
    "language"            VARCHAR(5) NOT NULL DEFAULT 'en',
    "printed_references"  JSONB NOT NULL DEFAULT '[]',
    "printed_parties"     JSONB,
    "notes"               TEXT,
    "internal_note"       TEXT,
    "payment_terms_text"  VARCHAR(1000),
    "discount_percent"    DECIMAL(5,2),
    "subtotal"            DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discount_amount"     DECIMAL(15,2) NOT NULL DEFAULT 0,
    "net_amount"          DECIMAL(15,2) NOT NULL DEFAULT 0,
    "vat_amount"          DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_amount"        DECIMAL(15,2) NOT NULL DEFAULT 0,
    "vat_by_rate"         JSONB NOT NULL DEFAULT '[]',
    "base_currency"       CHAR(3) NOT NULL DEFAULT 'SEK',
    "rate_to_base"        DECIMAL(18,6),
    "rate_source"         VARCHAR(20),
    "rate_date"           DATE,
    "subtotal_base"       DECIMAL(15,2),
    "vat_base"            DECIMAL(15,2),
    "total_base"          DECIMAL(15,2),
    "declaration_period"  VARCHAR(12),
    "pdf_document_id"     UUID,
    "issued_at"           TIMESTAMPTZ,
    "sent_at"             TIMESTAMPTZ,
    "decided_at"          TIMESTAMPTZ,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"          TIMESTAMPTZ NOT NULL,
    "created_by"          UUID NOT NULL,
    "source"              VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "invoices_related_invoice_id_fkey" FOREIGN KEY ("related_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invoices_due_after_issue_check" CHECK ("due_date" IS NULL OR "due_date" >= "issue_date"),
    CONSTRAINT "invoices_discount_percent_check" CHECK ("discount_percent" IS NULL OR ("discount_percent" >= 0 AND "discount_percent" <= 100)),
    CONSTRAINT "invoices_credit_note_needs_original_check" CHECK ("type" <> 'credit_note' OR "related_invoice_id" IS NOT NULL),
    CONSTRAINT "invoices_issued_have_number_check" CHECK ("status" = 'draft' OR "number" IS NOT NULL),
    CONSTRAINT "invoices_currency_upper_check" CHECK ("currency" = upper("currency"))
);

-- drafts have no number; issued numbers are unique per tenant
CREATE UNIQUE INDEX "invoices_tenant_number_key" ON "invoices"("tenant_id", "number") WHERE "number" IS NOT NULL;
CREATE INDEX "idx_invoices_tenant_partner" ON "invoices"("tenant_id", "partner_id");
CREATE INDEX "idx_invoices_tenant_type_status" ON "invoices"("tenant_id", "type", "status");
CREATE INDEX "idx_invoices_tenant_issue_date" ON "invoices"("tenant_id", "issue_date" DESC);
CREATE INDEX "idx_invoices_tenant_declaration_period" ON "invoices"("tenant_id", "declaration_period");
CREATE INDEX "idx_invoices_tenant_related" ON "invoices"("tenant_id", "related_invoice_id");

CREATE TABLE "invoice_lines" (
    "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"        UUID NOT NULL,
    "invoice_id"       UUID NOT NULL,
    "line_no"          INTEGER NOT NULL,
    "description"      VARCHAR(5000) NOT NULL,
    "quantity"         DECIMAL(10,4) NOT NULL,
    "unit"             "rate_unit" NOT NULL DEFAULT 'day',
    "unit_price"       DECIMAL(15,2) NOT NULL,
    "discount_percent" DECIMAL(5,2),
    "discount_amount"  DECIMAL(15,2) NOT NULL DEFAULT 0,
    "net_amount"       DECIMAL(15,2) NOT NULL,
    "vat_rate"         DECIMAL(5,2) NOT NULL,
    "vat_amount"       DECIMAL(15,2) NOT NULL,
    "period_start"     DATE,
    "period_end"       DATE,
    "rate_source_id"   UUID,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"       TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "invoice_lines_quantity_check" CHECK ("quantity" >= 0),
    CONSTRAINT "invoice_lines_unit_price_check" CHECK ("unit_price" >= 0),
    CONSTRAINT "invoice_lines_discount_percent_check" CHECK ("discount_percent" IS NULL OR ("discount_percent" >= 0 AND "discount_percent" <= 100)),
    CONSTRAINT "invoice_lines_net_not_negative_check" CHECK ("net_amount" >= 0),
    CONSTRAINT "invoice_lines_vat_rate_check" CHECK ("vat_rate" >= 0 AND "vat_rate" <= 100)
);

CREATE UNIQUE INDEX "invoice_lines_invoice_line_no_key" ON "invoice_lines"("invoice_id", "line_no");
CREATE INDEX "idx_invoice_lines_tenant_rate_source" ON "invoice_lines"("tenant_id", "rate_source_id");

-- RLS
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoices"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "invoices" TO defterfab_app;

ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoice_lines"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "invoice_lines" TO defterfab_app;

-- Immutability (constitution §1: money facts are written once). Once a document leaves 'draft' only these
-- columns may still change: status (issued → sent, accepted/declined), sent_at, decided_at,
-- declaration_period (an audited override), pdf_document_id (set once by the render job), updated_at.
-- A non-draft document is never deleted and never goes back to draft.
CREATE OR REPLACE FUNCTION invoices_lock_when_issued() RETURNS trigger AS $$
DECLARE
    mutable TEXT[] := ARRAY['status', 'sent_at', 'decided_at', 'declaration_period', 'pdf_document_id', 'updated_at'];
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'draft' THEN
            RAISE EXCEPTION 'invoice_locked' USING ERRCODE = 'P0001',
                DETAIL = format('invoice %s is %s and cannot be deleted', OLD."number", OLD."status");
        END IF;
        RETURN OLD;
    END IF;
    IF OLD."status" = 'draft' THEN
        RETURN NEW;
    END IF;
    IF NEW."status" = 'draft' THEN
        RAISE EXCEPTION 'invoice_locked' USING ERRCODE = 'P0001',
            DETAIL = format('invoice %s cannot go back to draft', OLD."number");
    END IF;
    IF NEW."pdf_document_id" IS DISTINCT FROM OLD."pdf_document_id" AND OLD."pdf_document_id" IS NOT NULL THEN
        RAISE EXCEPTION 'invoice_locked' USING ERRCODE = 'P0001',
            DETAIL = format('invoice %s already has its PDF', OLD."number");
    END IF;
    IF (to_jsonb(OLD) - mutable) <> (to_jsonb(NEW) - mutable) THEN
        RAISE EXCEPTION 'invoice_locked' USING ERRCODE = 'P0001',
            DETAIL = format('invoice %s is %s and cannot be changed — issue a credit note', OLD."number", OLD."status");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_lock_when_issued
    BEFORE UPDATE OR DELETE ON "invoices"
    FOR EACH ROW EXECUTE FUNCTION invoices_lock_when_issued();

CREATE OR REPLACE FUNCTION invoice_lines_lock_when_issued() RETURNS trigger AS $$
DECLARE
    inv_id UUID := COALESCE(NEW."invoice_id", OLD."invoice_id");
    inv_status "invoice_status";
BEGIN
    SELECT "status" INTO inv_status FROM "invoices" WHERE "id" = inv_id;
    IF inv_status IS NOT NULL AND inv_status <> 'draft' THEN
        RAISE EXCEPTION 'invoice_locked' USING ERRCODE = 'P0001',
            DETAIL = format('lines of a %s invoice cannot change', inv_status);
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Not fired by the cascade of a draft delete (the parent is a draft) nor by an issued delete (refused above).
CREATE TRIGGER invoice_lines_lock_when_issued
    BEFORE INSERT OR UPDATE OR DELETE ON "invoice_lines"
    FOR EACH ROW EXECUTE FUNCTION invoice_lines_lock_when_issued();

-- A linked invoice (a bank transaction justifies it) is never hard-deleted — same guard as documents.
CREATE TRIGGER invoices_block_delete_when_linked
    BEFORE DELETE ON "invoices"
    FOR EACH ROW EXECUTE FUNCTION block_delete_when_linked('invoice');
