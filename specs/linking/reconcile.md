# Reconcile — the match stage (F139, D76 phase 5)

> Pulse phase 5, from the board *Reconcile — the match stage* (D77) and the owner's picks of 2026-11-07 — **must**: the match stage with its lines and reasons, the *when you accept* preview, duplicate detection, asks only about the unsure field; **nice** (taken when cheap): the queue grouped, *accept all ready*, the high-confidence fields prefilled, the undo list. Left for later: *do it by itself next time* / teach once (a rule from the stage — F129's rule proposal exists, its button here is a next PR), the document's picture on the stage.

The engine is F116's (`inboxRows`: candidates scored with memory, cross-currency within the window); the writes are F104 / F114's (`applySuggestion`, `bulkApplyHigh`, `removeLink`) and banking's `categorise`. This page is a read model and one composite write.

## US1 — one month, one row at a time (P1)

`/banking/reconcile` (Banking › Reconcile; *Open in Reconcile* from a bank row, *Continue* from Work's step 3, the dashboard's *rows to justify*): **Reconcile {month}** — *N rows left*, the month's rows done / all. `?month=yyyy-mm`; without it, the oldest month (of the last twelve) that still has a row to justify, else this month. `?row=<id>` puts a row in focus.

- The **queue** on the left, grouped: **Ready** (the best candidate is HIGH and the partner is known — from the row, or from the candidate) with *Accept N*; **To check** (a candidate, but something is unsure: not HIGH, or no known partner); **Needs a document** (no candidate, the partner known); **Who is this?** (no candidate, no partner); **Done today** (the links made today from a bank row, newest first, each with *Undo*).
- The **stage** in the middle for the row in focus: the match — the bank row and the candidate side by side, the lines between them (the scorer's reasons: same reference, same name, the days apart, the amount equal or equal after FX), the confidence and the reasons in words; the **partner** and the **category** — shown as facts when they are sure (typed on the row, carried by the candidate), prefilled and marked when proposed (the counterparty memory, F98's proposal), asked when nothing is known; the **currency conversion** when the candidate is in another currency (the original, the ECB rate of the candidate's day, the ECB amount, what the bank charged, the bank's FX cost and its %); **when you accept**: what the click will do, line by line.
- *Accept and next* (Enter) · *Other candidates* (the next suggestions, a click picks one) · *Do it by hand* (the bank row's own panel: Justify, upload, no proof) · *Skip* (J / ↓; K / ↑ back). A row with no candidate opens on its own panel directly.
- **Duplicate detection**: two open rows of the month on the same account, the same day, the same amount and the same counterparty are **twins** — each says so (*two rows, same day, same amount — one invoice for both?*); and a candidate the other twin also proposes says *also proposed for its twin*.

## US2 — accept all ready (P2)

*Accept N* (Shift + Enter) applies the best candidate of every Ready row (`bulkApplyHigh`), reports applied / skipped, and the queue moves on.

## US3 — undo (P2)

*Done today* lists today's links from a bank row (`link.created_at` on the Stockholm day): the row, what it was linked to, *Undo* (removes the link — `removeLink`; a partner or category set by the accept stays, the History says so). Ctrl + Z undoes the last one.

## Requirements

- **FR-001** `reconcileData(tx, caller, month, today)` (read): the month's rows to justify (`inboxRows` with the month's span), each grouped (`reconcileGroup`, pure), its sure / proposed / missing partner and category (`stageFields`, pure), its twins (`twinsOf`, pure), the FX of a cross-currency best candidate (`rates.rateToBase` of the candidate's day, the bank's cost), the month's progress (`banking.bankMonths`), today's links, the months before / after; the partner and category options. Nothing stored.
- **FR-002** `acceptMatch(tx, caller, audit, { bankTransactionId, to, allocatedAmount?, partnerId?, basCode? })` — one transaction: `applySuggestion`, then `banking.categorise` with only the fields the owner confirmed (none when the candidate carries them). Owner only, audited by the two services. Returns the link.
- **FR-003** The page: ground (D76), the queue card (≈ 320 px) and the stage card; the keyboard J / K / ↓ / ↑ move, Enter accepts, Shift + Enter accepts all ready, Ctrl + Z undoes the last of today; the accountant reads the page and sees no write.
- **FR-004** Strings `reconcile.*` (en only, D62). Work's step 3 *Continue* and the dashboard's *rows to justify* item open `/banking/reconcile`; the inbox stays for its second tab (documents with no row).

## Tests

Pure: `reconcileGroup`, `stageFields`, `twinsOf`, `bankFxCost`. DB: `reconcileData` on an invented month (a HIGH same-currency invoice, a cross-currency receipt, twins, a row with nothing), `acceptMatch` (link + partner + category in one go; refusal leaves nothing). Component: the stage's sure / proposed / asked fields, the preview lines. e2e: the owner accepts a row on the stage and undoes it.
