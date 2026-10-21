-- Document inbox (specs/documents/spec.md, D32): the hash of the stored bytes — set once at upload or generation,
-- the upload-time duplicate check reads it; null on rows stored before this (scripts/backfill-document-hashes.ts) —
-- and the parking flag (archived_at / archived_by), a fact beside the pipeline status, never a status value.
ALTER TABLE "documents"
    ADD COLUMN "content_hash" CHAR(64),
    ADD COLUMN "archived_at" TIMESTAMPTZ,
    ADD COLUMN "archived_by" UUID;

-- not unique: "Upload anyway" stores a second copy with the same hash on purpose
CREATE INDEX "idx_documents_tenant_content_hash" ON "documents"("tenant_id", "content_hash");
