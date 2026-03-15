-- AlterTable
ALTER TABLE "documents" ADD COLUMN "corrections" JSONB,
ADD COLUMN "reviewed_at" TIMESTAMPTZ,
ADD COLUMN "reviewed_by" UUID;
