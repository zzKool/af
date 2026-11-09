-- F169 (the board *Invoice studio*: "Draft a reminder if it is not paid 3 days after the due date"): a per-invoice
-- switch for the reminder the studio drafts when an invoice is late (F143). On by default — every existing invoice
-- keeps today's behaviour. Additive; nothing dropped or rewritten.
ALTER TABLE "invoices" ADD COLUMN "remind_when_late" BOOLEAN NOT NULL DEFAULT true;

-- The switch is a hand-set fact like sent_at: an issued invoice may still turn it on or off. The lock function is
-- the one of 20261020230000_add_invoices with `remind_when_late` added to the mutable columns — nothing else changes.
CREATE OR REPLACE FUNCTION invoices_lock_when_issued() RETURNS trigger AS $$
DECLARE
    mutable TEXT[] := ARRAY['status', 'sent_at', 'decided_at', 'declaration_period', 'pdf_document_id', 'remind_when_late', 'updated_at'];
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
