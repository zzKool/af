-- F98 (specs/ai): proposals — what the rules, the history and (PR 2) the local model propose for a bank row's
-- category or partner. The only table the AI side writes; accepting goes through banking's categorise.
-- Additive only. The row is a composite FK (D63, RESTRICT): banking's deleteImport drops a row's proposals first.

CREATE TYPE "proposal_target" AS ENUM ('bank_transaction');
CREATE TYPE "proposal_kind" AS ENUM ('bas', 'partner');
CREATE TYPE "proposal_source" AS ENUM ('rule', 'partner_default', 'memory', 'model');
CREATE TYPE "proposal_decision" AS ENUM ('accepted', 'rejected');

CREATE TABLE "proposals" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"      UUID NOT NULL,
    "run_id"         UUID NOT NULL,
    "target_type"    "proposal_target" NOT NULL,
    "target_id"      UUID NOT NULL,
    "kind"           "proposal_kind" NOT NULL,
    "payload"        JSONB NOT NULL,
    "source"         "proposal_source" NOT NULL,
    "confidence"     DECIMAL(3,2) NOT NULL,
    "reason"         VARCHAR(200),
    "model"          VARCHAR(100),
    "prompt_version" VARCHAR(20),
    "facts_hash"     VARCHAR(64) NOT NULL,
    "decision"       "proposal_decision",
    "decided_at"     TIMESTAMPTZ,
    "decided_by"     UUID,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"     UUID NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposals_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
    -- a decision is a fact with a time: both or neither
    CONSTRAINT "proposals_decision_check" CHECK (("decision" IS NULL) = ("decided_at" IS NULL)),
    -- the model's provenance travels together
    CONSTRAINT "proposals_model_check" CHECK ("source" <> 'model' OR ("model" IS NOT NULL AND "prompt_version" IS NOT NULL))
);

CREATE UNIQUE INDEX "proposals_target_kind_run_key" ON "proposals"("tenant_id", "target_type", "target_id", "kind", "run_id");
CREATE INDEX "idx_proposals_target" ON "proposals"("tenant_id", "target_id", "kind", "created_at" DESC);

ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_target_id_fkey"
    FOREIGN KEY ("tenant_id", "target_id") REFERENCES "bank_transactions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- RLS, like every tenant table
ALTER TABLE "proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proposals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "proposals"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "proposals" TO af_app;
