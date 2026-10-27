-- F116 PR C1 (specs/linking/one-engine.md FR-007, D67): a rule matches more than text — the paying account, the
-- sign, an expected amount with a tolerance, a cadence. Additive: every existing rule keeps matching as before
-- (any account, any sign, no amount, no cadence).
CREATE TYPE "rule_sign" AS ENUM ('any', 'in', 'out');
CREATE TYPE "rule_cadence" AS ENUM ('none', 'monthly', 'quarterly', 'yearly');

ALTER TABLE "categorisation_rules"
    ADD COLUMN "bank_account_id" UUID,
    ADD COLUMN "sign" "rule_sign" NOT NULL DEFAULT 'any',
    ADD COLUMN "expected_amount" DECIMAL(15, 2),
    ADD COLUMN "tolerance_pct" DECIMAL(5, 2) NOT NULL DEFAULT 0.5,
    ADD COLUMN "cadence" "rule_cadence" NOT NULL DEFAULT 'none';

ALTER TABLE "categorisation_rules"
    ADD CONSTRAINT "categorisation_rules_tenant_id_bank_account_id_fkey"
    FOREIGN KEY ("tenant_id", "bank_account_id") REFERENCES "bank_accounts" ("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "categorisation_rules_tenant_id_bank_account_id_idx"
    ON "categorisation_rules" ("tenant_id", "bank_account_id");

ALTER TABLE "categorisation_rules"
    ADD CONSTRAINT "categorisation_rules_expected_amount_check" CHECK ("expected_amount" IS NULL OR "expected_amount" > 0),
    ADD CONSTRAINT "categorisation_rules_tolerance_pct_check" CHECK ("tolerance_pct" >= 0 AND "tolerance_pct" <= 50);
