-- F126 (specs/ai/spec-suggest-from-first-entry.md FR-202): a *Use for* note per active BAS account — drafted by
-- the local model, confirmed or written by the owner; the BAS proposals' prompt reads it. Additive, no data change.
CREATE TYPE "bas_note_state" AS ENUM ('draft', 'confirmed');

ALTER TABLE "tenant_bas_preferences"
  ADD COLUMN "use_for" VARCHAR(300),
  ADD COLUMN "use_for_state" "bas_note_state";

-- a note has a state, a state has a note
ALTER TABLE "tenant_bas_preferences"
  ADD CONSTRAINT "tenant_bas_preferences_use_for_state_check"
  CHECK (("use_for" IS NULL) = ("use_for_state" IS NULL));
