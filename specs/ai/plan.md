# Plan — F98 PR 1: `kernel/ai`, proposals, stage 1

Spec: `specs/ai/spec.md` (approved 2026-10-27). PR 1 = everything but the model call (FR-005 stage 2, FR-010 eval → PR 2). Lane FULL, one PR (schema + code — the review's "schema first, then one PR" collapsed: no other open branch touches `prisma/`).

## Found while planning (changes nothing in the spec's intent)

- **Rules already run at import** (`applyToTransactions`): a row a rule matches arrives categorised. A `rule` proposal therefore only appears for rows imported *before* the rule existed (rules are not re-applied by themselves). Kept: cheap, and it is the honest source.
- **A partner-only rule brings the partner's default category** at import too, so `partner_default` fires mainly for rows whose partner was set by hand without a category.
- **The memory that exists today is banking's own history**, not F116's link memory (`memoryFor`, not built): the rows with the same `counterparty_key` whose category / partner the owner set by hand. That is US1 exactly, and it is banking's data → `banking.categoryMemory(tx, keys)`. F116's link memory joins it as a fourth input when it lands (one call in `stage1.ts`).
- **The composite FK RESTRICT would block `deleteImport`** once a row has a proposal. D63 forbids a cascade across modules; banking's `deleteImport` calls `linking.dropProposalsFor(tx, ids)` first (linking writes its own table; banking already reads linking's index).

## Schema (`prisma/schema/linking.prisma`, migration `20261028090000_add_proposals`)

```
enum proposal_target   bank_transaction
enum proposal_kind     bas · partner
enum proposal_source   rule · partner_default · memory · model
enum proposal_decision accepted · rejected

proposals  id uuid pk · tenant_id → tenants (CASCADE, like every tenant table)
           run_id uuid · target_type · target_id uuid
           (tenant_id, target_id) → bank_transactions (tenant_id, id) RESTRICT (D63)
           kind · payload jsonb · source · confidence numeric(3,2) CHECK 0–1
           reason varchar(200)? · model varchar(100)? · prompt_version varchar(20)?
           facts_hash varchar(64)
           decision? · decided_at? · decided_by uuid?   CHECK decision ⇔ decided_at
           created_at · created_by uuid · source_channel? — no: `created_by` + the run is the provenance
           UNIQUE (tenant_id, target_type, target_id, kind, run_id)
           INDEX (tenant_id, target_id, kind, created_at DESC)
           RLS tenant_isolation · GRANT to af_app
```

*current* = the newest row per (target, kind); *open* = current ∧ undecided ∧ the row still lacks that fact (bas null / partner null) — all derived on read.

## Code

```
src/kernel/ai/
  ai.ts             resolveAiProvider(env) · createAiService() · complete() (fetch, AbortSignal timeout)
                    · aiStatus() (GET {base}/models, 1.5 s, cached 60 s) — the only HTTP to a model
  schema.ts         jsonSchemaOf(zod) (z.toJSONSchema, additionalProperties false)
  types.ts          AiResult, AiCall, AiError
  ai.test.ts        recorded llama-server responses (invented), timeout, invalid output, off
src/kernel/auth/users.ts   + tenantOwners(db) — the nightly job's tenants
src/app/api/health          + ai: off | ok | unreachable
src/modules/banking/
  category-memory.ts  categoryMemory(tx, keys) → per key { bas: [{code, n}], partner: [{id, n}] } (manual rows only)
  import.ts           deleteImport → linking.dropProposalsFor first
  banking.actions.ts  importCsvAction → onCommit enqueue linking.proposeForRowsJob({ importId })
  queries.ts          + proposedBasCode · proposedSource · proposedConfidence (derived, from linking.currentProposals)
src/modules/linking/proposals/
  stage1.ts         pure: (row, ruleHit, partnerDefault, memory) → Draft[]  (FR-004)
  policy.ts         pure: familyOf(confidence) · PREFILL_HIGH · resolveDisagreement (FR-006)
  facts-hash.ts     pure: sha256(bas | partner | key | amount)
  proposals.ts      runProposals(tx, caller, rowIds, runId) · currentProposals(tx, ids) · accept / reject ·
                    dropProposalsFor · proposalStats(tx, days) · rowsWithoutProposal (nightly)
  payload.ts        Zod per kind, parse on read
  jobs/propose.ts   linking.propose-for-rows ({ tenantId, userId, importId | transactionIds }) ·
                    linking.propose-nightly (03:30 Stockholm, once) → each tenant's owner, every open row
  components/proposal-line.tsx   the Proposed line (code, label, family, source word, reason, Accept / Reject)
src/modules/linking/linking.actions.ts  getProposalsAction · acceptProposalAction · rejectProposalAction ·
                    runProposalsNowAction · getAiStatusAction
src/modules/banking/components/categorise-form.tsx  `proposal` prop: HIGH pre-fills the select, drawn as a proposal
src/app/(app)/settings/ai/page.tsx + linking/components/ai-settings.tsx  status · model · last run · rates · Run now
src/instrumentation.ts  + linking's jobs and schedule
```

Accept = one transaction: `banking.categorise(…, { by: manual })` with the payload's fact, the proposal `accepted` (+ audit), returns `proposeRule` when the key has no active rule (the Justify path's rule offer). Reject = the proposal `rejected` (+ audit); the next run skips that kind while the row's `facts_hash` is unchanged.

## Tests

`ai.test.ts` · `schema.test.ts` · `stage1.pure.test.ts` · `policy.pure.test.ts` (+ property: a stage-1 source alone is HIGH; a disagreement is never HIGH; nothing below 0.55 is shown) · `facts-hash.pure.test.ts` · `category-memory.test.ts` (DB) · `proposals.test.ts` (DB: US1, a rule made after the import, partner default, superseded derived, accept one transaction + audit, reject + skip, deleteImport with proposals, accountant cannot decide, RLS) · `categorise-form.test.tsx` (pre-fill drawn as a proposal, not saved) · guard: no `AI_*` env read and no model SDK outside `kernel/ai` · e2e `ai-proposals.spec.ts`: import → categorise two rows of one key by hand → a third row → *Run now* → the proposal pre-filled → Accept → categorised.
