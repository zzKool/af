-- The per-diem breakdown is its own PDF document (D29): the trip references it once rendered (validated UUID,
-- cleared on recompute so the job renders again).
ALTER TABLE "trips" ADD COLUMN "per_diem_document_id" UUID;
