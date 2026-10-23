-- F87 (D49, D50): an optional partner on expenses — the merchant as a vendor, for spend per partner.
-- Additive only. A validated UUID through the partners module, no FK (constitution §2). Not a money fact:
-- `expenses_lock_when_settled` keeps its column list, so the partner can change in every state.
-- A per-diem is written by the trip and never has a partner (FR-001).

ALTER TABLE "expenses" ADD COLUMN "partner_id" UUID;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_per_diem_no_partner_check"
    CHECK ("kind" <> 'per_diem' OR "partner_id" IS NULL);

CREATE INDEX "expenses_tenant_id_partner_id_idx" ON "expenses"("tenant_id", "partner_id");
