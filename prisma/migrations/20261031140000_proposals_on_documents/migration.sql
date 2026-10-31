-- F126 (specs/ai/spec-suggest-from-first-entry.md FR-203): proposals on documents — the model's BAS account for a
-- receipt or a supplier invoice before it becomes an expense / a supplier invoice. One FK column per target type
-- (a column cannot reference two tables), kept equal to target_id by CHECKs; RESTRICT both ways (D63).
CREATE UNIQUE INDEX "documents_tenant_id_id_key" ON "documents"("tenant_id", "id");

-- the new value is not used below in this transaction (PostgreSQL forbids that until commit)
ALTER TYPE "proposal_target" ADD VALUE IF NOT EXISTS 'document';

ALTER TABLE "proposals"
  ADD COLUMN "bank_transaction_id" UUID,
  ADD COLUMN "document_id" UUID;

UPDATE "proposals" SET "bank_transaction_id" = "target_id" WHERE "target_type" = 'bank_transaction';

ALTER TABLE "proposals" DROP CONSTRAINT "proposals_tenant_id_target_id_fkey";

ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_bank_transaction_id_fkey"
  FOREIGN KEY ("tenant_id", "bank_transaction_id") REFERENCES "bank_transactions"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_document_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- exactly the column of the target's type is set, and it is the target
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_target_column_check" CHECK (
  ("bank_transaction_id" IS NOT NULL) = ("target_type" = 'bank_transaction')
  AND ("document_id" IS NOT NULL) = ("target_type" <> 'bank_transaction')
  AND COALESCE("bank_transaction_id", "document_id") = "target_id"
);

CREATE INDEX "idx_proposals_document" ON "proposals"("tenant_id", "document_id") WHERE "document_id" IS NOT NULL;
