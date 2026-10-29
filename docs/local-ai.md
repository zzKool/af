# Local AI — the model on the box, the adapter, the proposals

> **Built so far (2026-10-28, F98 PR 1):** `kernel/ai` (§2: provider, `complete()`, status, the mock, the guard), the `proposals` table and stage 1 (§3, §4.1 1a–1c, §4.4–§4.6: rules · partner default · the owner's history; no model), the *Proposed* line + pre-fill + list column, Settings → AI, `/api/health`'s `ai`. Next: PR 2 — stage 2 through the model + `npm run ai -- eval` (`specs/ai/tasks.md` T013–T016). The module doc of what exists is [[linking]] *Proposals*; this page stays the design.
>
> Plan for the owner's read (2026-10-27), ahead of the FULL-lane specs of **F98** (adapter + proposals) and **F99** (the closing run). It says what gets built, in what order, and where every line of it goes. **No code before the owner's word** on the questions at the end. The box-specific runbook (hardware, VM sizing, addresses) is `private/local-ai-box.md` — gitignored, never in the repo (CLAUDE.md, *Real data*).

The design here deepens [[review-2026-10-26]] §3 and §8 and keeps their rule: **the model proposes, the owner's key writes, and a rule remembers** — the model is called less every month.

## 0. In one picture

```
 the hypervisor (Proxmox)
 ┌─────────────────────────────────────┐     ┌──────────────────────────────────────┐
 │ VM-A  af (prod compose)             │     │ VM-B  ai (one container)             │
 │  app ── kernel/ai ──── http ────────┼─────┼─► llama-server  (OpenAI-compatible,  │
 │  db   ◄── proposals   AI_BASE_URL   │     │    grammar-constrained JSON,         │
 │  jobs: ai.propose · ai.closing-run  │     │    prompt cache, CPU build)          │
 │  documents (fs)                     │     │    one GGUF model, no internet       │
 └─────────────────────────────────────┘     └──────────────────────────────────────┘
        nothing leaves the LAN: the prompt carries real rows, the answer comes back, no log keeps either

 a bank row / a document
   ─► stage 1  rules · partner default · memory (F116)     deterministic, free   ─► proposal (source: rule | history)
   ─► stage 2  the model, only for what stage 1 left open  seconds, on VM-B      ─► proposal (source: model, confidence, reason)
   ─► the owner confirms in Work (one key)                 the existing service writes the fact / the link
   ─► a learned rule is created from the confirmation      next month stage 1 answers it
```

Two layers that already exist carry most of the value: the categorisation rules ([[banking]]) and the engine's memory (`memoryFor`, [[one-engine|specs/linking/one-engine.md]] FR-004). The model fills the gap between them and the owner's keyboard.

## 1. The model VM — what AF expects of it

AF does not care what runs the model; it talks to **one OpenAI-compatible endpoint** and nothing else (constitution §1.8: a different site is different env vars). What the endpoint must do, and why `llama-server` (llama.cpp) is the pick for a CPU box:

| need | why | llama-server |
|---|---|---|
| `POST /v1/chat/completions` | one adapter, any backend (a hosted model later is the same code) | yes |
| **JSON constrained by a schema** | a BAS code that is not in the active list must be impossible, not just unlikely | grammar from `response_format: { type: "json_schema" }` — the enum is enforced token by token |
| **prompt cache** | the BAS list + examples are ~1 500 tokens, the row ~100: cached prefix → a row costs seconds, not a minute | on by default; the static part of the prompt goes first, the row last |
| one process, one model file, an API key, a health route | a container on a VM, nothing to manage | `ghcr.io/ggml-org/llama.cpp:server`, `--api-key`, `/health` |
| CPU builds that use the box's vector instructions | no GPU in this chassis | AVX2 build; threads = the VM's cores |

Ollama does the same job with a model manager on top; it is fine as a first try. The plan standardises on llama-server because the model is one explicit file (pinned, reproducible, no background pulls) and the grammar path is the reference one. Either way AF sees `AI_BASE_URL`.

**Hardware, honestly.** Token speed on a CPU is memory-bandwidth-bound: a 4B model at 4-bit (~2.5 GB) on a dual-channel DDR4 desktop gives roughly 6–10 tokens/s, an 8B model about half that; prompt processing is compute-bound and the slow part — which is why the cache matters. Budget per bank row with the cache warm: **2–6 s** (a 4B), 5–12 s (an 8B). Thirty residual rows a month = minutes, in the background, never on a keystroke. The sizing and the two upgrade paths (more RAM for a mixture-of-experts model, a GPU box later) are in the private runbook; the adapter does not change for either.

**Model choice is a measurement, not an opinion.** The candidates of the 4B class today (Qwen 3.5 4B, Gemma 4 E4B, Phi-4-mini; Granite 3.3 8B / Qwen3 8B when the RAM allows) all produce schema-valid JSON under a grammar; what differs is accuracy on *this* tenant's rows and multilingual bank text (Swedish / French / English / German card descriptors). §9's eval picks: replay the owner's confirmed rows through the pipeline on the box, count agreements per model, keep the best. `AI_MODEL` is the only thing that changes.

**When VM-B is down**: proposals say *AI not available (model VM unreachable)*; stage 1 still runs; the owner works as today. Nothing waits on it (constitution §1.9).

## 2. `kernel/ai` — the adapter

Mirrors `kernel/ocr`: one kernel folder owns the provider, nothing else does HTTP to a model (a guard rule), a mock that runs **only when named**, never on the box (F108's rule).

```
src/kernel/ai/
  ai.ts            resolveAiProvider() · complete() · the one fetch
  schema.ts        zod → JSON schema (z.toJSONSchema), strict, additionalProperties: false
  prompt.ts        PromptSpec { task, version, system, context, examples, input } → messages (static parts first)
  errors.ts        AiError: unavailable | timeout | invalid_output | refused
  ai.test.ts       the adapter on recorded responses of llama-server's shape (invented content)
  __fixtures__/    one recorded response per task shape
```

```ts
interface AiService {
  complete<T>(call: {
    task: string;            // "banking.bas-proposal" — the log key and the metrics key
    promptVersion: string;   // "v1" — bumped with any change of the prompt text
    messages: Message[];     // built by prompt.ts
    schema: z.ZodType<T>;    // the output, enforced by the grammar AND re-validated here
    maxTokens?: number;      // default 300 — proposals are short
    temperature?: number;    // default 0 — the same row gives the same answer
  }): Promise<AiResult<T>>;
}
type AiResult<T> =
  | { ok: true; data: T; model: string; promptVersion: string; durationMs: number; tokens: { prompt: number; completion: number; cached: number } }
  | { ok: false; error: "unavailable" | "timeout" | "invalid_output"; retryable: boolean; detail: string };
```

| env var | meaning |
|---|---|
| `AI_PROVIDER` | `openai-compatible` (the box, llama-server or Ollama) · `mock` (dev / tests, named only) · unset = **off**: every AI stage returns `unavailable`, the UI says so once per page |
| `AI_BASE_URL` | `http://<model-vm>:8080/v1` — the LAN address of VM-B |
| `AI_API_KEY` | the key llama-server was started with |
| `AI_MODEL` | the model name the server reports (`/v1/models`), logged on every call |
| `AI_TIMEOUT_MS` | default 60 000; a slow CPU answer is a timeout, retried once by the job |
| `AI_CONCURRENCY` | default 1 — one request at a time to a CPU box (the server has one slot) |

Rules carried over from OCR ([[ocr-processing]] *Security*): **never log a prompt or an answer** — only task, model, prompt version, duration, tokens, the confidence; the answer is re-validated with Zod even though the grammar constrained it (a server without grammar support, or Ollama's looser mode, must not slip through); `temperature 0`; every call tagged with `promptVersion` so an acceptance-rate drop can be traced to a prompt change.

Tests: the adapter on recorded responses (the provider's shape, never our mock — lessons 2026-10-24); `schema.ts` on every task schema (round-trip: the JSON schema accepts exactly what Zod accepts); the mock returns one fixed, invented answer per task so the e2e journeys are deterministic. CI never sets `AI_BASE_URL`.

## 3. Proposals — the one table the model is allowed to write

Owned by `modules/linking` (the composition module: Work, the Justify panel, the inbox). The model never writes anywhere else.

```
proposals   id · tenant_id · run_id (the job that made it)
            target_type ∈ bank_transaction | document · target_id (composite FK, RESTRICT — D63)
            kind ∈ partner | bas | link | entity_kind | check
            payload jsonb          the proposal itself, typed per kind (read through a Zod parser, lessons 29)
                                   partner: { partnerId | newPartner: { name, type } }
                                   bas:     { basCode, alternatives: [{ basCode, why }] }
                                   link:    { toType, toId, allocation }      (from the engine, F116 — not the model)
                                   entity_kind: { kind ∈ expense | supplier_invoice, group }
                                   check:   { code, sentence, severity ∈ info | warn }
            source ∈ rule | partner_default | memory | engine | model
            confidence 0–1 · reason (≤ 160 chars, shown) · model? · prompt_version?
            decided_at? · decision ∈ accepted | rejected · decided_by?
            UNIQUE (target_type, target_id, kind, run_id)
```

- **A decision is a fact, not a status**: *accepted* / *rejected* records the owner's key with a time; *superseded* is **derived** (a newer run has a proposal for the same target and kind); *current* = the newest run's. Nothing on the row says "proposed" — the row's facts stay the row's.
- **Accepting writes through the owning service**, exactly as the Justify panel does today: `banking.categorise` (partner, BAS — `categorised_by = manual`, the owner's key *is* the categorisation), `linking.createLink`, `partners.createPartner`. The proposal is marked accepted in the same transaction; a failed write leaves it undecided.
- **Learning**: accepting a `partner` or `bas` proposal whose counterparty key matches no active rule offers the rule (`createRuleFromTransaction`, F97 US3 — already built) pre-filled with the accepted facts, `rule_source = learned`. One key. The second Microsoft row is then stage 1's.
- **Acceptance rates per kind and source** (`proposalStats(tx, window)`) are the only evaluation that matters and go on Settings → AI (§8) — the model's self-reported confidence is calibrated against them (§4.4).

## 4. UC1 — the BAS account proposal (the one the owner asked for first)

### 4.1 The pipeline

```
 bank row (or a document that became an entity without a category)
   │
   ├─ 1a  an active rule matches        ─► bas from the rule           source rule            conf 1.00  (exists today)
   ├─ 1b  the row has a partner          ─► the partner's default BAS   source partner_default conf 0.95  (exists today)
   ├─ 1c  memoryFor(counterparty_key)    ─► the BAS of the N links      source memory          conf f(N)  (F116 FR-004: basCodes[] per partner)
   │       (the mode of basCodes, N ≥ 2, ≥ 70 % agreement)
   ├─ 2   the model                      ─► bas + alternatives + reason source model           conf calibrated (§4.4)
   │       only when 1a–1c gave nothing, or disagree
   └─ 3   nothing                        ─► no proposal; the picker as today
```

Stage 1 ships before any model exists and already covers the recurring vendors. Stage 2 is for the **new counterparty**: the first row of a new SaaS, a hotel abroad, a one-off purchase.

### 4.2 The prompt (`modules/banking/ai/bas-proposal.prompt.ts`, version `v1`)

Static first (cached across rows), the row last:

```
system    You categorise a bank movement of a Swedish consulting company (aktiebolag, one consultant, Swiss VAT-registered,
          travels for work) into ONE category of its chart of accounts. Categories are BAS groups used as labels — not a ledger.
          Answer in JSON only. Prefer a specific category over a general one. If the movement looks private, say so in flags.
context   The active categories (settings.activeBasCategories — ~30–50 lines), one per line:
            6540 · Software and IT services · Datakommunikation / IT-tjänster · e.g. OPENAI, MICROSOFT, GITHUB
            5800 · Travel · Resekostnader · e.g. SJ, SBB, LUFTHANSA, hotels
            6570 · Bank charges · Bankkostnader · e.g. AVGIFTER NORDEA
            …
          the "e.g." part is built from the tenant's own history (the counterparty keys linked to that code most often,
          max 4, upper-cased, no amounts) — the owner's book teaches the model his vocabulary
examples  up to 8 confirmed rows of this tenant (the most recent per class) as JSON pairs — invented in tests
input     the row: { date, amount, currency, direction, accountRole, counterpartyKey, text (the five columns joined),
          partner?: { name, type, country }, document?: { vendor, items[≤5], vatRate, total } }
```

Output schema (Zod → JSON schema → the grammar):

```ts
z.object({
  basCode: z.enum(activeCodes),                       // the enum is built per call from the tenant's active set
  confidence: z.number().min(0).max(1),
  reason: z.string().max(160),
  alternatives: z.array(z.object({ basCode: z.enum(activeCodes), why: z.string().max(80) })).max(2),
  flags: z.array(z.enum(["looks_private", "no_document_expected", "reverse_charge_likely", "unsure_direction"])),
})
```

`basCode` outside the active set cannot be produced; `activeCodes` is at most the tenant's preferences, so the enum stays small. The three names of each code come from `basLabel` (F95), so the model reads English and Swedish together — the card descriptors it sees are the raw text, whatever the language.

### 4.3 Worked case (invented)

```
 row   2026-07-14  −2 312.43 SEK  main SEK  "ANTHROPIC* CLAU 1234"   partner: none   rule: none   memory: none
 → stage 2
 { basCode: "6540", confidence: 0.82, reason: "Anthropic sells an AI/LLM subscription; recurring card charge; matches OPENAI rows",
   alternatives: [{ basCode: "6590", why: "other external services if not treated as IT" }], flags: [] }
 → proposal (bas, model, 0.82)  +  proposal (partner, model, newPartner: { name: "Anthropic", type: supplier })  §5
 → Work: the Category section shows  Proposed 6540 · Software and IT services  (0.82) — <reason>   [Accept] [6590] [Pick…]
 → `a`: banking.categorise(bas 6540, partner Anthropic) · proposal accepted · the rule *ANTHROPIC → 6540 · Anthropic* offered
```

### 4.4 Confidence, calibrated — the number shown is not the model's number

The model's `confidence` is a hint. The shown confidence and the behaviour come from the source and from history:

| shown | when | in Work |
|---|---|---|
| **HIGH** | rule · partner default · memory with N ≥ 3 and full agreement · model ≥ 0.80 **and** the code is one of the partner-type's usual codes | pre-filled; one key accepts; the closing list counts it as *proposed* |
| **MEDIUM** | memory with disagreement · model 0.55–0.80 · model HIGH but stage 1 disagrees (both shown) | shown with the alternatives, nothing pre-filled |
| **LOW / none** | model < 0.55 · `looks_private` flagged | *No proposal* — the picker as today; the flag becomes a `check` (§6) |

The thresholds are constants in `modules/linking/proposals/policy.ts`, pure and tested; §9's eval moves them with evidence, never a settings page.

### 4.5 Where it is shown and written

- **Work / the banking panel** — the Category section (`CategoriseForm`) gains a *Proposed* line above the picker: code, label, confidence family (the D40 state families: HIGH = done-ish, MEDIUM = in progress, LOW = attention), the reason, *Accept* (`a`), the alternatives as chips, *Pick…* (the existing picker). Accept = `acceptProposalAction({ proposalId })` → `banking.categorise` + the rule offer.
- **The Justify compare card** (F97) — pre-filled from the current proposals: partner, kind, BAS; the card says where each came from (*rule* / *remembered* / *proposed*).
- **The inbox list** — one chip per row: the proposed BAS short code with its family colour, so a month can be read at a glance.
- **Documents** — the same pipeline on a document that *became* an entity without a category: the entity's panel shows the proposal; the write is the entity module's own `update`.

### 4.6 Jobs

`linking.propose-for-rows` (`{ importId }` or `{ transactionIds }`, exclusive on the import id): after every import, stage 1 for every new row, then stage 2 for the residual, one request at a time; `expireInSeconds` 900; a timeout retries once, then dead-letters into a `check` proposal (*AI did not answer for 3 rows*). The nightly `linking.closing-run` (§5) re-runs it for rows still open. `JOBS_DISABLED` and `AI_PROVIDER` unset both make it a no-op that logs once.

### 4.7 Tests

`bas-proposal.pure.test.ts` — the prompt builder on invented rows (snapshot of the static prefix: it must not change between rows, or the cache is lost), the examples' selection, the schema's enum; `policy.pure.test.ts` — the table above as cases and as properties (a rule always HIGH, a flagged private never pre-filled); `proposals.test.ts` (DB) — stage order on seeded rows, superseded derivation, accept writes the row and marks the proposal in one transaction, reject writes nothing, RLS; e2e with `AI_PROVIDER=mock` — a new counterparty gets a proposal, `a` categorises, the rule offer appears.

## 5. UC2 — the counterparty and the closing run (the month closes itself)

**Counterparty → partner.** Same three stages: a rule with a partner (exists), memory (`memoryFor`: the partner most linked to this key — F116), the model for the rest, with the tenant's partners (name, type, country — ~50–200 lines, cached) in the context and this schema: `{ partnerId: z.enum(ids) | null, newPartner?: { name, type ∈ supplier | client | authority | other, country? }, confidence, reason }`. "MSFT * E0100ZW7M8 → Microsoft" is world knowledge a 4B model has; the normaliser in `counterparty.ts` (card prefix, trailing digits, `K*`) runs first so the model sees `MSFT`, not the token salad. A `newPartner` proposal creates the partner on accept (`partners.createPartner`, like the compare card's *New supplier*).

**The closing run** (`linking.closing-run`, nightly at 03:30 Europe/Stockholm, `once` catch-up; also *Run now* from Work): for every open or partial row of the main accounts and every unresolved document, in one pass:

```
 1. stage 1 + stage 2 proposals (partner, bas)                       §4, above
 2. the engine's candidates (F116): a HIGH link candidate → a `link` proposal (source engine)
 3. no candidate: the nearest miss as a sentence → `check`  ("the Lufthansa receipt of 10-14 is 12 % off — different booking?")
 4. the deterministic checks (§6) over the month → `check` proposals
 5. one summary row per run: counts per bucket (proposed · needs a proof · looks wrong) — the dashboard's new to-do line
```

Work gains a **Closing** view (the inbox filtered to the newest run, grouped by bucket, the same key map): `a` accepts the row's proposals together (partner + BAS + link when all HIGH — one transaction, the same services), `j` next, `x` no proof needed, `p` drop a proof, `r` reject (a rejection is recorded; the same proposal is not re-made by the next run unless the facts changed). Success criterion (review §8): a month of thirty rows in under ten minutes; every accepted HIGH proposal that was wrong is a lesson, reproduced on invented rows.

What the run never does: write a fact, a link or a flag. Its output is proposals and a summary; the keys are the owner's.

## 6. UC3 — "this looks wrong": the mistake detector

Two halves on one `check` kind; the deterministic half ships first, without a model, inside the closing run.

**Deterministic checks** (pure, tested, each one function in `modules/linking/checks/`):

| code | fires when | severity |
|---|---|---|
| `vat_sum` | a document's net + VAT ≠ total beyond rounding | warn |
| `duplicate_amount` | the same |amount| and counterparty twice within 7 days, neither a transfer | warn |
| `fx_delta` | an FX difference on a link above the tolerance (F114) | warn |
| `billed_to_other` | a proof whose *billed to* is not the company (D53) | warn |
| `missing_proof_month_end` | an open outgoing row in a closed month | info |
| `subscription_price_moved` | a rule with an expected amount hit outside its tolerance (F116 PR C near miss) | info |
| `reverse_charge_untagged` | OCR read reverse charge, the entity has no tag (F91) | warn |
| `weekend_restaurant` | a restaurant / café receipt on a Saturday or Sunday | info (the model decides whether to say more) |

**The judgement half** (the model, one call per flagged row, same adapter): the row, its proof's reading and the firing checks go in; out comes `{ verdict ∈ fine | question | likely_wrong, sentence ≤ 160, suggestedAction ∈ none | mark_private | split | reclassify | ask_accountant }`. Only `question` and `likely_wrong` become a `check` proposal; `fine` silences the deterministic one for that row (recorded, so a later run does not re-ask). Examples of the sentences it is good at: *a restaurant in Zürich on a Sunday with no trip that week — private?*; *two invoices from the same vendor for July — one period billed twice?*; *this hotel receipt is categorised Software*.

**The accountant's questions, pre-answered**: the owner pastes the accountant's last questions once (Settings → AI → *What the accountant asks*); each becomes a named check the run evaluates before every package (`package/collect.ts` reads the current `check` proposals of the month and writes them into `notes.md` as answers — a `check` with `fine` is *checked, nothing found*). No model needed for most; the model drafts the answer sentence where the check is a judgement.

## 7. UC4 — ask your books (Ctrl K → a question → a table or a chart)

For a BI engineer this is the fun one, and it is safe when the model can only **read, through views, as a role that can do nothing else**.

```
 Ctrl K  "SaaS spend 2025 in CHF by vendor"
   ─► kernel/ai: task search.sql, context = the DDL of 6 read-only views + 10 example pairs (invented)
   ─► { sql, columns: [{ name, kind ∈ money | date | text | count }], chart ∈ none | bar | line, note }
   ─► guard: pgsql-ast-parser → exactly one SELECT · only the views · no functions outside an allow-list · LIMIT ≤ 500 added
   ─► run as role af_ask (SELECT on the views only, statement_timeout 5 s, RLS on, SET LOCAL app.tenant_id)
   ─► the palette shows the table, the SQL (always), the chart when `chart` ≠ none (the kernel's chart widget)
   ─► "Open in Transactions" when the result is rows of one view (the ids come back → `/banking?ids=`)
```

The views (`prisma/migrations/…_ask_views.sql`, documented in `docs/exports.md`): `v_ask_transactions` (date, account, counterparty, partner, bas code + label, amount, currency, base, state), `v_ask_links`, `v_ask_documents` (key, type, vendor, total, currency, reviewed), `v_ask_invoices`, `v_ask_expenses`, `v_ask_subscriptions`. No raw text columns, no IBANs, no notes. The role `af_ask` is created by the migration and granted exactly those; its password is an env var like the app role's. A question the guard refuses is answered with *I can only read the views; try …* — never a second attempt that widens.

Why it works on a 4B CPU model: the schema is six views with explicit names, the examples cover the ten shapes that matter (by month, by vendor, by category, open rows, over a period, in a currency, top N), and the answer is ~80 tokens. Wrong SQL is cheap: it runs read-only and shows itself.

## 8. Riders — small things on the same adapter

- **The second reader**: when Azure DI returns `rawText` but misses the currency, the vendor VAT number or the document kind (the 2026-10-24 lesson), one call over the raw text fills the gap as a *proposal on the document* (`kind = entity_kind` / the reading's corrections), never as a reading; the review page shows it as a suggestion. Also the **service period** of an invoice (for F96's SCB quarter) and *credit note* detection (F116 FR-006).
- **BAS English names** (F95): the one-off translation of the active set — the model's first useful job, reviewed once on the settings page.
- **SCB service type per partner** (F96): proposed from the partner's type, country and BAS history; set once.
- **Settings → AI**: endpoint status (`/health`, model, last run, its duration), acceptance rates per kind and source for 30 / 90 days, *Run the closing run now*, *What the accountant asks*, the prompt versions in use. No model picker, no temperature slider: the box's env vars are the configuration (constitution: no settings engine for a single use).

## 9. Evaluation, privacy, failure

- **The eval is on the box, by the owner, with his data — results are counts.** `npm run ai -- eval [--since 2026-01] [--model …]` replays the confirmed rows (facts set by hand or accepted proposals) through stage 1 and stage 2 and prints, per source and per BAS code: agreement with the owner's fact, the confusion pairs (6540 ↔ 6590), p50 / p95 seconds. It never prints a row. Two models are two runs; `AI_MODEL` changes. The same command before every prompt version bump.
- **D51 holds**: the prompt carries real rows and leaves only to VM-B on the LAN; VM-B has no route to the internet after the model is pulled; no log on either side keeps a prompt or an answer; the repo holds prompts with placeholders and tests with invented rows; screenshots on seed data.
- **Failure is quiet**: unavailable → stage 1 only and one line on the page; timeout → one retry, then a `check`; invalid output → logged with the task and prompt version, no proposal. The month can always be closed by hand as today.

## 10. Phasing — what gets built, in which lane

```
 P0  the box (owner, private runbook)  VM-B · llama-server · the model · the firewall · AF_* env vars on VM-A · smoke test
 P1  F98-a  kernel/ai + proposals (schema PR, serialised) + stage 1 proposals (rules · default · memory) + the Work line   FULL — no model needed yet
 P2  F98-b  stage 2 (BAS + partner via the model) + the mock + `ai eval`                                                     FULL, same spec
 P3  F99    the closing run + the deterministic checks + the Closing view + the summary on the dashboard                      FULL
 P4  F99-b  the judgement half of the checks + the accountant's questions                                                     LIGHT
 P5  F100   ask your books (views + role migration · the guard · the palette)                                                 FULL (a new role, a migration)
 P6  riders the second reader · F95 translation · F96 service type                                                            with their own rows
```

Depends on: **F116 PR A** (memory) for stage 1c — build P1 after it, or P1 reads a stub; **F114** for the FX check; **F97** (built) for the panel and the rule offer. Sizes: P1 M · P2 M · P3 M · P4 S · P5 M · P6 S each. Every PR: `docs/local-ai.md` becomes the module doc of what exists, this plan's sections moving into [[linking]], [[banking]] and [[search]] as they are built.

## 11. Questions for the owner (one batch)

1. **The box**: CPU-only on today's RAM (a 4B model, 0 CHF) to start — and decide the RAM upgrade (a mixture-of-experts 30B-class model at 4B speed, inside your 100–150 CHF) after the first eval? The runbook has both. A GPU does not fit this chassis; that path is a different box, later.
2. **Order**: P1 → P2 → P3 as above (BAS and partner proposals first, the closing run second) — or the closing run first with stage 1 only, since the deterministic half already changes the month?
3. **The nightly run**: wanted, or only after an import and on *Run now*? (The nightly catches late proofs and the checks; it costs nothing when nothing is open.)
4. **Ask your books**: in this plan (P5), or parked until the first three are in use? It is the only item that adds a database role.
5. **Proposals on documents** (the second reader, §8): with P2, or later? It is the only part that touches the review page (F117 says the page is not a record — a proposal fits that).
6. **A rejected proposal**: never re-made for that row (the plan), or re-made when the model or the prompt version changes?

## Related

[[review-2026-10-26]] §3, §8 · [[one-engine|specs/linking/one-engine.md]] (F116) · `specs/justify/spec.md` (F97) · [[banking]] (rules, the row's facts) · [[linking]] · [[ocr-processing]] (the adapter pattern, the mock rule) · [[async-jobs]] · [[environment-variables]] · [[constitution]] §1.8–1.9 · `private/local-ai-box.md` (the owner's runbook, not in the repo)
