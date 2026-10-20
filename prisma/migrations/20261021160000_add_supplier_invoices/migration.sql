-- Supplier invoices (D8, D28, D-g; specs/supplier-invoices/spec.md): payables keyed SI{group}-{alias}-{seq} in the
-- expense groups, with a due date, VAT under a registration, optional split lines; paid by `justifies` links.
-- partners.payment_terms_days: the due-date default of a supplier's invoices.

ALTER TABLE "partners" ADD COLUMN "payment_terms_days" INTEGER;
ALTER TABLE "partners" ADD CONSTRAINT "partners_payment_terms_check" CHECK ("payment_terms_days" IS NULL OR ("payment_terms_days" >= 0 AND "payment_terms_days" <= 365));

CREATE TABLE "supplier_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "key" VARCHAR(30) NOT NULL,
    "seq" INTEGER NOT NULL,
    "alias" VARCHAR(6) NOT NULL,
    "partner_id" UUID NOT NULL,
    "invoice_number" VARCHAR(100) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "due_date_defaulted" BOOLEAN NOT NULL DEFAULT false,
    "currency" CHAR(3) NOT NULL,
    "amount_net" DECIMAL(15,2) NOT NULL,
    "vat_amount" DECIMAL(15,2) NOT NULL,
    "amount_total" DECIMAL(15,2) NOT NULL,
    "amount_base" DECIMAL(15,2) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "rate_source" VARCHAR(20) NOT NULL,
    "rate_date" DATE,
    "paid_amount" DECIMAL(15,2),
    "paid_currency" CHAR(3),
    "bas_code" VARCHAR(4) NOT NULL,
    "vat_registration_id" UUID,
    "document_missing" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "supplier_invoices_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "expense_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "supplier_invoices_number_check" CHECK (length(btrim("invoice_number")) > 0),
    CONSTRAINT "supplier_invoices_dates_check" CHECK ("due_date" >= "invoice_date"),
    CONSTRAINT "supplier_invoices_amounts_check" CHECK ("amount_net" >= 0 AND "vat_amount" >= 0 AND "amount_total" > 0),
    CONSTRAINT "supplier_invoices_total_check" CHECK (abs("amount_total" - "amount_net" - "vat_amount") <= 0.01),
    CONSTRAINT "supplier_invoices_rate_positive_check" CHECK ("rate" > 0),
    CONSTRAINT "supplier_invoices_seq_check" CHECK ("seq" > 0),
    CONSTRAINT "supplier_invoices_currency_upper_check" CHECK ("currency" = upper("currency")),
    CONSTRAINT "supplier_invoices_paid_pair_check" CHECK (("paid_amount" IS NULL) = ("paid_currency" IS NULL)),
    CONSTRAINT "supplier_invoices_paid_amount_positive_check" CHECK ("paid_amount" IS NULL OR "paid_amount" > 0),
    CONSTRAINT "supplier_invoices_rate_source_check" CHECK ("rate_source" IN ('same_currency', 'ecb_daily', 'ecb_nearest', 'bank', 'manual')),
    CONSTRAINT "supplier_invoices_cancelled_check" CHECK (("cancelled" = false) OR ("cancelled_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "supplier_invoices_tenant_key_key" ON "supplier_invoices"("tenant_id", "key");
CREATE UNIQUE INDEX "supplier_invoices_group_alias_seq_key" ON "supplier_invoices"("group_id", "alias", "seq");
-- exact duplicates are refused here; the case- and space-insensitive rule is the service's (`checkDuplicateNumber`), the
-- schema cannot declare an expression index and the drift check would flag one
CREATE UNIQUE INDEX "supplier_invoices_tenant_partner_number_key" ON "supplier_invoices"("tenant_id", "partner_id", "invoice_number");
CREATE INDEX "supplier_invoices_tenant_id_due_date_idx" ON "supplier_invoices"("tenant_id", "due_date");
CREATE INDEX "supplier_invoices_tenant_id_invoice_date_idx" ON "supplier_invoices"("tenant_id", "invoice_date" DESC);
CREATE INDEX "supplier_invoices_tenant_id_partner_id_idx" ON "supplier_invoices"("tenant_id", "partner_id");
CREATE INDEX "supplier_invoices_tenant_id_group_id_idx" ON "supplier_invoices"("tenant_id", "group_id");

CREATE TABLE "supplier_invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "amount_net" DECIMAL(15,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_amount" DECIMAL(15,2) NOT NULL,
    "bas_code" VARCHAR(4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "supplier_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "supplier_invoice_lines_line_no_check" CHECK ("line_no" > 0),
    CONSTRAINT "supplier_invoice_lines_amounts_check" CHECK ("amount_net" >= 0 AND "vat_amount" >= 0 AND "vat_rate" >= 0)
);
CREATE UNIQUE INDEX "supplier_invoice_lines_invoice_line_key" ON "supplier_invoice_lines"("invoice_id", "line_no");
CREATE INDEX "supplier_invoice_lines_tenant_id_invoice_id_idx" ON "supplier_invoice_lines"("tenant_id", "invoice_id");

-- The key is assigned once; the money facts are the service's to lock (once a payment link exists).
CREATE OR REPLACE FUNCTION supplier_invoices_lock_key() RETURNS trigger AS $$
BEGIN
    IF NEW."key" IS DISTINCT FROM OLD."key" OR NEW."seq" IS DISTINCT FROM OLD."seq" OR NEW."alias" IS DISTINCT FROM OLD."alias"
       OR NEW."group_id" IS DISTINCT FROM OLD."group_id" THEN
        RAISE EXCEPTION 'supplier_invoice_locked' USING ERRCODE = 'P0001',
            DETAIL = format('supplier invoice %s: the key is assigned once', OLD."key");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER supplier_invoices_lock_key
    BEFORE UPDATE ON "supplier_invoices"
    FOR EACH ROW EXECUTE FUNCTION supplier_invoices_lock_key();

CREATE TRIGGER supplier_invoices_block_delete_when_linked
    BEFORE DELETE ON "supplier_invoices"
    FOR EACH ROW EXECUTE FUNCTION block_delete_when_linked('supplier_invoice');

ALTER TABLE "supplier_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_invoices"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "supplier_invoices" TO defterfab_app;

ALTER TABLE "supplier_invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_invoice_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_invoice_lines"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "supplier_invoice_lines" TO defterfab_app;
