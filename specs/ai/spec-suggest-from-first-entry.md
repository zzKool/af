# Feature Specification: BAS suggested from the first entry (F98 PR 2 revised, F126, F99-b part, D68)

**Created**: 2026-10-31 · **Status**: decided by the owner's answers below — build in the order of *PRs*; no further read needed unless a PR finds a contradiction.

**Input** (the owner, 2026-10-31): *"The whole point of having a local AI was to help me with all these categorisations — the BAS account was one of them. I don't want to have to complete a few entries for each one. I want it directly suggested."* · *"I asked you which BAS account suits each of my transactions (office workspace, a software licence, a cloud subscription …). I don't want this hardcoded."* · Swedish names: D72 (built, #341).

## The owner's answers (2026-10-31, one batch)

| question | answer |
|---|---|
| The model VM | **Running** on the box — PR 2 can ship to the box's `AI_PROVIDER` once its eval passes (SC-004 of `spec.md`) |
| Four-digit BAS (D68) | **Yes, four digits** — one migration `NNN` → `NNN0`, the chart at main-account + sub-account level (`6071` / `6072`) |
| Where the account knowledge lives | **AI drafts, I review** — one English *Use for* note per **active** account in Settings → BAS, drafted once by the model, edited / confirmed by the owner; the prompt reads the notes. **Nothing in code** maps a vendor or a word to an account |
| The accountant's package | **Swedish + English** — built with D72 (`6540 IT-tjänster (IT services)`) |

This answers [[local-ai]] §11 Q5 (*proposals on documents*): **with P2**, not later.

## What changes, in one picture

```
today                                   after
─────                                   ─────
bank row ── stage 1 (rule · partner     bank row ── stage 1 ──► open? ──► stage 2: the model
            default · history ≥ 2) ──►                                    (active accounts + their notes
            nothing on a new vendor                                        + confirmed examples) ──► proposal
document ── OCR ──► dialog: picker      document ── OCR ──► stage 1 + stage 2 on the document
            with history only                     ──► dialog / Justify: the proposal on top, HIGH pre-filled
```

## User scenarios

**US1 — A new vendor's first bank row is proposed (P1).** Given a row whose counterparty has no rule, no partner default and no history, when the import's job runs with the model up, then the row carries a `bas` proposal from the model — code, confidence, a one-line reason in English — and, at HIGH, the Category picker is pre-filled (dashed) with it (`PREFILL_HIGH`, unchanged). Never saved until the owner accepts.

**US2 — A document is proposed before it becomes anything (P1).** Given a receipt or supplier invoice PDF whose OCR finished, when the document's proposal job runs, then the document carries a `bas` proposal (and a `partner` one when the vendor matches no partner exactly), and the *New supplier invoice* / *New expense* dialog and the Justify card open with it: on top of the picker as *AI proposal* with its reason, HIGH pre-filled. The first document of a new vendor needs no prior entry.

**US3 — The owner reviews what the model knows (P1).** Given the active accounts, when the owner opens Settings → BAS → *Use for notes* and clicks *Draft with AI*, then each active account without a note gets an English draft (≤ 200 characters: what goes there, what does not, the usual neighbour) marked *draft*; he edits or confirms each, or *Confirm all*. A confirmed note is his — the model never overwrites it; a re-draft touches drafts only.

**US4 — The notes steer the proposals (P1).** Given a confirmed note on `6540` that says *software licences and cloud subscriptions*, when a row or a document for a new cloud vendor is proposed, then the prompt carried that note, and the eval (US5 of `spec.md`) can show the agreement moving when a note is edited. Changing a note changes the prompt's static prefix → its hash is part of `prompt_version`'s facts, so an old rejection does not block a new proposal (US4 of `spec.md`, *facts changed*).

**US5 — The model is off (P1).** Everything above degrades to stage 1 and the history; the dialogs show what they show today; *Draft with AI* is disabled with *AI not available*.

## Requirements

- **FR-201 Stage 2 on bank rows** — `spec.md` FR-005 / FR-006 / T013–T016 as written, with: the static prefix = system text · the active accounts as `code · English name · Swedish name · Use for note` (confirmed notes and drafts alike — a draft is the model's own reading, so it changes nothing to mark it) · up to eight confirmed rows (the owner's categorised rows, newest per code). No counterparty-name → account table anywhere in code or prompt text. Output: `basCode: z.enum(activeCodes)`, confidence, reason ≤ 160 (English), ≤ 2 alternatives.
- **FR-202 Account notes** (`modules/settings`): `tenant_bas_preferences.use_for text NULL`, `use_for_state` enum `draft | confirmed` NULL; `draftUseForNotes(tx, caller)` asks the model once per batch of active accounts lacking a confirmed note (prompt `bas-use-for` v1: the account's code, English and Swedish names, its class, BAS's own sense of the account; output `{ code: enum, useFor: string ≤ 200 }[]`); `updateBasPreference` accepts `useFor` (owner's edit = confirmed). Settings → BAS: a *Use for* line per active account (draft in italics with *Confirm*), *Draft with AI*, *Confirm all*. Audit on every write. Strings in `en.ts`.
- **FR-203 Proposals on documents** — `ProposalTarget` gains `document` (`spec.md` FR-003 already reserves it): composite FK `(tenant_id, target_id)` → `documents`, RESTRICT; deleting a document drops its proposals first (D63, like `deleteImport`). Inputs: the OCR's vendor name / VAT number / line descriptions / total / currency / the document type — never the file. Stage 1 on a document: an exact partner match (D70's fold) → that partner's default BAS and history; stage 2 when open. Job `linking.propose-for-document` enqueued when OCR completes; *Run now* covers open documents.
- **FR-204 Where a document's proposal shows** — the SI and expense dialogs (opened from a document, the inbox or Justify) and the Justify compare card read the document's current proposals: in the BAS picker's *Suggested* group as source `model` (*AI proposal*) or the stage-1 word, with the reason; HIGH pre-fills the field dashed (`proposed`), MEDIUM sits on top unfilled, LOW is not shown. Accepting = saving the dialog with that code; the proposal is marked `accepted` in the same transaction; saving another code marks it `rejected`.
- **FR-205 Four-digit BAS (D68)** — its own serialised schema PR, *before* FR-202 lands on the box or after it, never in parallel: `bas_categories` reloaded at four digits (main accounts `NNN0` + sub-accounts) from the two BAS XLSX files (Swedish + English, gitignored, parsed by `prisma/data/parse-bas.mjs` extended to four digits); every stored code `NNN` → `NNN0` in one migration (bank rows, rules, partners' defaults, expenses, supplier invoices, subscriptions, proposals' payloads, preferences incl. notes and short codes); expense / SI business keys unchanged (they carry the alias, not the code); the picker groups by class as today. **Irreversible on the box** → the owner's word before it is deployed (CLAUDE.md), the PR may merge on green.
- **FR-206 Tests** — pure: the prompt's static prefix identical across rows and changed by a note edit; no proposal outside the active set (property, the mock); a confirmed note never overwritten by a re-draft. DB: a document proposal written after OCR, dropped with the document, RLS; accept / reject through the dialog's save. e2e (`AI_PROVIDER=mock`): a new vendor's PDF → the dialog opens with *AI proposal* pre-filled → save → the expense carries the code. Migration test for FR-205: a seeded `654` reads `6540` everywhere after.

## Success criteria

- **SC-201** With the mock, the first document and the first bank row of a counterparty never seen before both show a proposal; no history needed.
- **SC-202** No vendor name, product name or keyword appears in code or prompt templates as a mapping to an account (a grep test on `prompts/` for the seed's partner names).
- **SC-203** The box's eval: the model's HIGH agrees with the owner's hand-set category ≥ 85 % (`spec.md` SC-004); below, the thresholds move before `AI_PROVIDER` is set on the box.

## PRs, in order

1. **Docs** (this file, the roadmap) — `docs/ai-suggest-spec`.
2. **F98 PR 2** `feat/ai-model-stage` — FR-201 (no schema). T013–T016.
3. **F126 notes** `feat/settings-bas-notes` — FR-202 (schema: two columns).
4. **F99-b proposals on documents** `feat/ai-document-proposals` — FR-203 / FR-204 (schema: enum value + FK).
5. **D68 four digits** `feat/settings-bas-four-digit` — FR-205 (schema; needs the two XLSX files on the build machine — they are licensed, never committed).

## Out of scope

The closing run and checks (F99), *ask your books* (F100), any model choice in code, a second reader of the OCR text beyond vendor / lines / totals.
