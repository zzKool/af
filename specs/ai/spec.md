# Feature Specification: Local AI proposals (F98)

**Feature Branches**: `feat/ai-kernel-proposals` (PR 1: `kernel/ai` + the `proposals` table + stage-1 proposals + the Work line — schema PR, serialised, **no model needed**), `feat/ai-model-stage` (PR 2: stage 2 through the model, the mock, `npm run ai -- eval`)

**Created**: 2026-10-27

**Status**: Approved by the owner 2026-10-27 (answers below) — ready for `/speckit-plan` (schema) and PR 1 · the design is [[local-ai]] §1–§4, §9

**Input**: the owner, 2026-10-26 / 27: "the local AI should pick the best BAS account, recognise the counterparty behind a bank text (a card descriptor → Microsoft) and detect mistakes"; D65 lifted 2026-10-27; the four planning questions answered *no preference* → the plan's defaults (below).

## Decisions taken from the plan's defaults (2026-10-27)

```
build order     proposals first (this spec),
                then the closing run (F99)
run timing      after every import + nightly
                + Run now
ask your books  in the plan, last (F100)
the box         CPU-only, a 4B model; the RAM
                upgrade decided after the first eval
documents       proposals on documents later (F99-b)
a rejection     never re-made for that row unless
                the facts, the model or the prompt
                version changed
BAS precision   the codes as stored — four digits
                once the BAS session's migration
                lands (handled separately); this
                spec reads `bas_code` and never
                assumes its length
```

## The rule, in five lines

1. **The model proposes, the owner's key writes, a rule remembers.** The model writes one table — `proposals` — and nothing else: no fact, no link, no status.
2. **Stage 1 before stage 2.** Rules → the partner's default → the engine's memory (F116 PR A, when built) answer first; the model is asked only for what they leave open. PR 1 ships stage 1 alone and is useful on its own.
3. **One adapter, one endpoint.** `kernel/ai` talks to an OpenAI-compatible URL (llama-server on the AI VM); environment differences are env vars; unset = AI off, the app works as today.
4. **A code outside the active BAS set is impossible**, not unlikely: the output schema's enum is the tenant's active codes, enforced by the server's grammar and re-validated with Zod.
5. **Nothing real leaves the LAN, nothing real is logged**: no prompt, no answer in any log; only task, model, prompt version, duration, tokens.

## User Scenarios

### US1 — A known counterparty is proposed without a model (P1, PR 1)

**Given** an imported row `OPENAI *CHATGPT 1234` with no rule hit and an earlier row of the same key categorised 6540 / OpenAI by hand, **when** the import's proposal job runs, **then** the row's Category section shows *Proposed 6540 · Software and IT services — remembered from 3 rows* (source `memory`, HIGH) with *Accept* (`a`); accepting writes `bas_code` and `partner_id` through `banking.categorise` (`categorised_by = manual`) and marks the proposal accepted in the same transaction; the toast offers *Create rule* (F97 US3's rule proposal). Until F116 PR A is built, stage 1 is rules + the partner default only and this scenario uses the partner default.

### US2 — A new counterparty is proposed by the model (P1, PR 2)

**Given** `ANTHROPIC* CLAU 1234`, no rule, no partner, no memory, **when** the job runs with the model reachable, **then** two proposals exist: `bas` (6540, confidence shown as a family, the reason ≤ 160 chars, up to two alternatives) and `partner` (`newPartner: Anthropic`, supplier); accepting both creates the partner (`partners.createPartner`) and categorises the row in one transaction.

### US3 — The model is off or slow (P1, PR 2)

**Given** `AI_PROVIDER` unset, or the AI VM unreachable, **when** the job runs, **then** stage 1 still writes its proposals, stage 2 writes none, the Work page shows once *AI not available* (no error toast per row), and nothing waits. A timeout is retried once, then the row is skipped for this run.

### US4 — A wrong proposal is rejected and stays rejected (P2, PR 1)

**Given** a proposal 6590 the owner rejects (`r`), **when** the nightly run passes again, **then** no new 6590 proposal is made for that row unless the row's facts, the model or the prompt version changed; the picker opens as today.

### US5 — The proposals are measured (P2, PR 2)

**When** the owner runs `npm run ai -- eval --since 2026-01` on the box, **then** it replays the rows whose category was set by hand or by an accepted proposal through stage 1 and stage 2 and prints, per source and per BAS code, the agreement rate and p50 / p95 seconds — **never a row, a name or an amount**. Settings → AI shows the same acceptance rates for 30 / 90 days, the endpoint status and the model name.

## Requirements

- **FR-001** `kernel/ai`: `resolveAiProvider(env)` (`openai-compatible` · `mock` named only · none), `complete({ task, promptVersion, messages, schema, maxTokens = 300, temperature = 0 })` → `AiResult<T>` (`ok` with data, model, durations, tokens incl. cached · `unavailable | timeout | invalid_output` with `retryable`); the Zod schema is sent as `response_format: json_schema` and the answer re-parsed with it. No other file does HTTP to a model (a guard rule beside the Azure SDK rule). No prompt or answer is logged. `/api/health` gains `ai: ok | off | unreachable`.
- **FR-002** Env vars ([[environment-variables]]): `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_MS` (60 000), `AI_CONCURRENCY` (1). CI never sets `AI_BASE_URL`; the e2e run sets `AI_PROVIDER=mock`.
- **FR-003** `proposals` (`prisma/schema/linking.prisma`, owned by linking): `id · tenant_id · run_id · target_type ∈ bank_transaction | document · target_id · kind ∈ partner | bas · payload jsonb · source ∈ rule | partner_default | memory | model · confidence numeric(3,2) · reason · model? · prompt_version? · facts_hash · decision ∈ accepted | rejected | null · decided_at? · decided_by? · created_at`; composite FK `(tenant_id, target_id)` to `bank_transactions` (D63, RESTRICT; `document` added with F99-b); RLS; `UNIQUE (target_type, target_id, kind, run_id)`. *Current* and *superseded* are **derived** (the newest run per target and kind); `payload` read through a Zod parser per kind. `kind = link | check | entity_kind` arrive with F99.
- **FR-004** Stage 1 (`modules/linking/proposals/stage1.ts`, pure over inputs fetched by the job): the first active rule that would set a category or partner (banking's `firstHit`, dry) → `rule`, 1.00; the row's partner's default BAS → `partner_default`, 0.95; `memoryFor(key)` (F116 FR-004) with N ≥ 2 and ≥ 70 % agreement → `memory`, `min(0.6 + 0.1·N, 0.95)`. A row already categorised by hand gets no proposal.
- **FR-005** Stage 2 (`modules/banking/ai/bas-proposal.prompt.ts`, `partner-proposal.prompt.ts`, version `v1`): static parts first (the system text, the active BAS lines with `basLabel` English + Swedish and up to four of the tenant's most-linked counterparty keys per code, up to eight confirmed rows as examples), the row last (date, amount, currency, direction, account role, counterparty key, the five text columns joined, the partner if any). Output schemas as [[local-ai]] §4.2 (`basCode: z.enum(activeCodes)`, confidence, reason ≤ 160, ≤ 2 alternatives, flags) and §5 (`partnerId: z.enum(ids) | null`, `newPartner?`). Called only when stage 1 left the kind open or two stage-1 sources disagree.
- **FR-006** The shown confidence (`modules/linking/proposals/policy.ts`, pure): HIGH = any stage-1 source at its confidence · model ≥ 0.80 with no stage-1 disagreement; MEDIUM = model 0.55–0.80 · model HIGH against a stage-1 source (both shown); LOW = below → no proposal shown. `looks_private` never pre-fills (the flag is kept for F99's checks).
- **FR-007** Jobs: `linking.propose-for-rows` (`{ importId } | { transactionIds }`, `exclusive`, `expireInSeconds` 900) enqueued by `importCsv` after its transaction commits; `linking.propose-nightly` (`ScheduleDefinition`, 03:30 Europe/Stockholm, `once`) for every open or partial main-account row without a current proposal; *Run now* on Settings → AI enqueues the nightly job. One model request at a time (`AI_CONCURRENCY`). A row is skipped when its `facts_hash` (BAS, partner, the text, the amount) matches a rejected proposal's (US4).
- **FR-008** Actions (`linking.actions.ts`, `ownerAction`): `acceptProposalAction({ proposalId, overrideBasCode? })` → one transaction: `partners.createPartner` when the payload has `newPartner`, `banking.categorise(…, { by: manual })`, the proposal `accepted`; returns `proposeRule` like the justify categorise path. `rejectProposalAction({ proposalId })`. The accountant reads proposals, never decides.
- **FR-009** UI ([[af-design]]): the banking panel's Category section and the inbox's right pane show the current proposal above `CategoriseForm` — code + label, confidence as a D40 family, the source word (*rule* · *partner default* · *remembered* · *proposed*), the reason, *Accept* (`a`), the alternatives as chips, *Pick…*; the Justify compare card (F97) pre-fills partner and BAS from the current proposals and names their source; the transactions list gets a *Proposed* column (code, family). Settings → AI: status, model, last runs, acceptance rates, *Run now*. Strings in `en.ts` only (D62).
- **FR-010** `npm run ai -- eval` (`scripts/ai-eval.ts`, read-only, the app role): US5's output; `--model` sets `AI_MODEL` for the run; exits non-zero when the endpoint is unreachable.
- **FR-011** Tests: `kernel/ai/ai.test.ts` on recorded responses of llama-server's shape (invented content) — schema sent, answer re-validated, timeout, unavailable, invalid output; `schema.test.ts` (the JSON schema accepts exactly what Zod accepts); `stage1.pure.test.ts`, `policy.pure.test.ts` (the table as cases and properties: a rule is always HIGH, `looks_private` never pre-fills); `bas-proposal.pure.test.ts` (the static prefix identical across rows — the cache; the enum is the active set); `proposals.test.ts` (DB: stage order on seeded rows, superseded derived, accept writes the row + the proposal in one transaction, a failed categorise leaves it undecided, reject writes nothing, the `facts_hash` skip, RLS); e2e with `AI_PROVIDER=mock`: an import → a proposal on a new counterparty → `a` → the row categorised → *Create rule* offered.
- **FR-012** Docs: [[local-ai]] becomes the module doc of what exists; [[linking]] (proposals), [[banking]] (the import's enqueue), [[environment-variables]], [[deployment]] (one generic paragraph: "point `AI_BASE_URL` at any OpenAI-compatible server"), [[features]] F98's row.

## Success Criteria

- **SC-001** On the seed with `AI_PROVIDER` unset, every row whose key has a rule or whose partner has a default BAS gets a HIGH stage-1 proposal after an import; no row gets a model proposal; no page shows an error.
- **SC-002** With the mock, a new counterparty gets a `bas` and a `partner` proposal within one job run; accepting both writes the row and the partner in one transaction (one audit set).
- **SC-003** No proposal anywhere carries a BAS code outside the tenant's active set (a property test over the mock's answers and the stage-1 sources).
- **SC-004** On the box (the owner's eval, counts only): stage-1 HIGH proposals agree with the owner's hand-set category ≥ 95 %; the model's HIGH ≥ 85 % — below that, the policy's thresholds move before PR 2 ships to the box's `AI_PROVIDER`.
- **SC-005** The import is not slower: `importCsv` only enqueues; the job runs after the transaction commits.

## The owner's answers (2026-10-27)

1. **The source is shown**: *rule* · *partner default* · *remembered* · *proposed* (the model) — FR-009 as written.
2. **HIGH proposals are pre-filled** in the Category picker, for now — the owner may switch back to *shown above, never pre-filled*. So the switch is **one constant** (`PREFILL_HIGH = true` in `proposals/policy.ts`, no setting) and the UI is built for both: a pre-filled value is drawn as a proposal (its family colour, the source word, *Accept* / `a`) until accepted — **it is not saved**, the row stays uncategorised and the package does not read it. MEDIUM and LOW are never pre-filled.
3. **A *Proposed* column** on the transactions list: the code + the D40 family colour, filterable (*has a proposal*, by source, by family) and sortable by confidence.

## Assumptions

- The AI VM exists and serves an OpenAI-compatible endpoint on the LAN (the owner's private runbook); without it, PR 1 is complete and PR 2 runs on the mock only.
- F116 PR A (`memoryFor`) may land before or after PR 1; stage 1 reads it when it exists (one call in `stage1.ts`, a test either way).
- The BAS migration (another session) changes the codes, not this design: `activeCodes` comes from the tenant's preferences at call time.

## Out of scope

The closing run, the checks, the `link` / `check` kinds (F99); proposals on documents and the second reader (F99-b); ask your books (F100); any model choice in the code (the box's `AI_MODEL`).
