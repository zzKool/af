-- partners.short_code: the invoice series key is {short_code}{yy} (D5) — e.g. VA → VA26-001.
ALTER TABLE "partners" ADD COLUMN "short_code" VARCHAR(6);
ALTER TABLE "partners" ADD CONSTRAINT "partners_short_code_check" CHECK ("short_code" IS NULL OR "short_code" ~ '^[A-Z0-9]{2,6}$');
CREATE UNIQUE INDEX idx_partners_tenant_short_code ON "partners" ("tenant_id", "short_code") WHERE "short_code" IS NOT NULL;
