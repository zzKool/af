# Document inbox — the documents desk

`/documents` (since F153; `/documents/inbox` redirects there; **F185: the page is the board *Documents***, the owner 2026-11-10) — the documents work page. No title row: the hero is the headline (an `sr-only` *Documents* h1 keeps the page's name). Spec: `specs/documents/spec.md` US4 (FR-016 – FR-024), decisions D32 / D34 / D77 / D78.

```
┌ Drop anything here ─────────────────────── [file.pdf 45% ▬▬ queued to be read] [IMG.HEIC 75% ▬▬▬ reading the page] [Add more] ┐
├ Inbox 5 · 1 need a look  ⚙ ┬ [Supplier invoice] detected · 1 page · read in 1.2 s · doc_…   hover a field ┬ What it read   7 sure · 1 to check ┤
│ ▌▢ Lindgren Kontorsservice │                                                                              │ Vendor   Lindgren …        99% │
│   [Supplier invoice] 1 269 │        ┌──────────── the page as paper ────────────┐                         │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ │
│   1 field to check         │        │ [box] [box]          one box per field    │                         │ Due date 2026-08-07         72% │
│ ▢ … (cards)                │        │        the active one ringed + glowing    │                         │ “07-08” — Aug 7 or Jul 8? [a][b]│
│                            │        └───────────────────────────────────────────┘                         │ WHEN YOU ACCEPT                 │
│ ┌ Duplicate? … ┐           │                                                                              │ [creates] Supplier invoice SI…  │
│ │ Discard · Keep both │    │                                                                              │ [links] Bank row … −1 269   98 %│
└────────────────────────────┴──────────────────────────────────────────────────────────────────────────────┴ [files] 6540 … · partner …     ┘
                                                                                                               [ Accept all three  Enter ]
```

```
upload ──► OCR ──► inbox row ──► Accept (Enter): creates · links · files ─────────► out (became) + a done card
                      │      └─► Make it… Expense / Supplier invoice (the form) ───► out (became)
                      │      └─► Just file it (= reviewed) ─────────────────────────► out (filed)
                      │      └─► 1–3 / Bank rows…: a bank row justifies it ─────────► stays until made / filed
                      └─► d archive (or *Discard it* on a duplicate) ──► Archived ──► r / u restore
```

## The board, piece by piece (F185)

- **Drop anything here** (`drop-hero.tsx`): the whole card takes a drop (and the tile *Choose files* opens the picker); each file goes through `uploadDocumentAction` as one drop does, no type (D78). On the right, one tile per file in flight — the files this page sends (*waiting* · *uploading* · *queued to be read*; a duplicate says *the same file as doc_…* with *Upload anyway*; a refusal its reason with *Try again*), then the inbox's rows still being read (*queued to be read* 45 % · *reading the page* 75 % · *stuck*); the % is the stage, not bytes. While anything is in flight the desk reads the inbox again every 3 s. `?new=1` still opens the upload zone in a dialog. The board's mail-forward address waits for a mailbox (F103).
- **Inbox** (`inbox-workbench.tsx`): *Inbox n · m need(s) a look* (*a look* = a field to check, a duplicate, stuck, failed, nothing read). A card per document: the paper thumbnail (`--paper` tokens), who (vendor, else the file), the kind as a **toned tag** (`BoardTag`: *Supplier invoice* blue, *Receipt* amber, *Duplicate?* red — D77, the board wins over D40's grey tag here), the amount in mono, one line (*1 field(s) to check* · *All read — ready to accept* · *Same file as doc_…* · *queued to be read* …; the state word for a row not ready); a 3 px left edge — the open card blue, a duplicate red, a done card green. A card accepted on this visit stays as **done** (*Became SI12-IT-03 · linked to bank row 2026-07-24*) until the page is left. The tick box shows on hover (or while any is ticked). The **tools** button (⚙) shows the search, the tabs with their counts, *All documents (n)* and the help — open by itself while a tab or a search is set. **The duplicate question** at the bottom: *{file} is the same file as {key}* — *Discard it* archives it (undoable, `u`), *Keep both* hides the question for this visit (nothing stored: two copies are allowed, FR-011).
- **The document** (`inbox-pane.tsx`): the header — the kind (`kindWord`: typed, or *detected* from the reading for a drop nobody typed), the pages, *read in n s* (DI's `processingTimeMs`, kept in the reading), the key in mono, the state for a row not ready, *hover a field on the right*; the page as **paper** (`DocumentPreview bare`: no toolbar, fitted whole into the column, the pages as chips under it when there are several — zoom and rotate stay on the review page) with a box on every field read (`MarksOverlay`: placed in % of the page from DI's polygon; sure in the reading colour `--read`, to check amber; the active one ringed 2.5 px and glowing).
- **What it read** (`read-fields.tsx` `WhatItRead`, shared with the reading dialog, F186): *n sure · m to check* (sure = DI's high band or the owner's word — `corrected`, the keys of `documents.corrections`); a row per field — label, value bold, the % on the right and a 3 px bar in its band (high `--read`, medium amber, low red; corrected: a check, full bar). Hover, focus or click makes it the active field (the first to check to begin with — the board). **A field to check opens in place** (`to-check.ts` `checkAsk`): a date printed with numbers only whose day and month could swap (`07-08`) → *“07-08” — Aug 7 or Jul 8?* with the two dates; a total ≠ net + VAT → both amounts; else *Read at 81 % — is it right?* · *Yes, it is* · *Change*. Every value can be corrected in place (the pencil, or double-click; Enter keeps it, Escape drops it). An answer or an edit is a **correction on the document** (`updateDocumentCorrectionsAction`, the review page's own write): the field becomes sure and the chain reads it again.
- **When you accept** (`accept-chain-view.tsx`; the read `documentAcceptChain` in linking, the pure half `accept-chain-rules.ts`): **creates** the entity — the kind from the type, else the reading (D78) — and its key peeked from the group's series (final at commit) · **links** the scorer's best **HIGH** bank row that `justifyRow` can take (outgoing, a main account, not justified yet) with its score · **files** the category (the document's BAS proposal F126, else the matched partner's default — one with a short code) and the partner (the match on the paper's vendor / VAT number, ≥ 60 %). The group is the one the paper's date proposes (`proposeGroupForDate`), else a new group for the month, made on the click (said under the button). One primary, worded by the steps — *Accept all three* / *Accept both* / *Accept* — and **Enter**: with a bank row `justifyRowAction` (entity + payment, one transaction), without one the supplier invoice's create (`createSupplierInvoiceAction`, the document picked); an expense without its bank row needs the form (its payer). What the chain lacks (a partner, a category, the invoice number…) shows in amber in its step, the primary becomes *Finish it in the form* and opens the module's pre-filled form (*Make it…*, as before). No new business rule: the actions validate their inputs as always.
- **Under the chain**: *Expense…* / *Supplier invoice…* (the forms), *Bank rows…* (the suggestions and *Link to…*, `l`; `1`–`3` link the n-th), *Just file it*, *Archive*, *Open* (the review page). The accountant sees the cards, the page and what was read — no chain, no answer, no edit.

## Who is in it

Derived, never stored (`modules/documents/inbox.ts`, `listInbox` in `queries.ts`): a document is an inbox row when it is **not generated**, **not reviewed** (filed), and **no `created_from` link** points at it (it became nothing yet). Archived rows stay under their own tab.

| State | From | Tab |
|---|---|---|
| `needs_ocr` | status `uploaded` | Pending |
| `processing` | status `processing` | Pending |
| `stuck` | `processing` for more than 5 min (`OCR_STUCK_AFTER_MS`) — captioned, *Run OCR* offered | Pending |
| `ocr_failed` | status `ocr_failed` | Pending |
| `ready` | status `extracted` | Ready |
| `archived` | `archived_at` set (any status) | Archived |

- **All** = Pending + Ready; the title says *{n} documents need attention* — the same number as the library's *Inbox (n)* link and the dashboard's *documents to review* (`inboxTotals`, SC-005) — and the sidebar's count on *Documents* (F72: `inboxOpenCount`, the same `inboxState` over the rows that can still be in the inbox, four columns, no facts or twins).
- **Duplicates** = inbox rows whose bytes (`content_hash`) exist more than once in the tenant (a linked, archived or **generated** twin counts — FR-011: the client's copy of an issued invoice, uploaded anyway, is captioned *Duplicate of InvoiceAF_LK26-INV-007.pdf*); the younger ones are captioned *Duplicate of {oldest key}*. A generated PDF is never an inbox row: `listInbox` reads only the generated rows whose hash a loaded document shares, and only their key, hash and date.
- Counts are over the whole inbox; the search (key, file name, vendor as corrected) and the tab narrow the list only.
- **Scale**: one read of the tenant's non-generated documents per request (cap 20 000, like the library) plus the generated twins of those hashes, state / twins / counts in memory. Right for one company; revisit when a tenant passes a few thousand documents ([[lessons]]).
- The accountant sees financial documents only (`can(read, relationship_document)` decides), and nothing he can change.

**The same rule for other modules** (read APIs on `index.ts`, lessons audit 26):

- `inboxFinancialFacts(tx, caller, { from, to } | { ids })` (F94) — the financial documents still in the inbox (the same rule) dated in the window by their OCR date, or picked by id, with the OCR facts as corrected: vendor, VAT number, number, dates, total / subtotal / tax, a known currency or null. The subscriptions matcher's receipts and bills.
- `candidateDocuments(tx, caller, types, { limit = 200 })` — the documents of those `prefixType`s still waiting in the inbox (any state but `archived`), newest first, each with its `state`. The rule runs before the limit, so taken documents never hide a free one. For the expense and supplier-invoice dialogs' document picker (their own copies move to it in their lanes).
- `documentsByIds(tx, ids)` carries `documentState` (`documentState()`: the inbox state, else `filed` / `generated`); `DocumentStateLabel` is on `documents/ui` — the partner page's Documents tab (partners T011).

## The actions by state

**D78 — a drop nobody typed** (`prefixType` `document`, `doc_…`): once read, the header says what the reading proposes (`readingProposes` in `proposes.ts` — an invoice number or a VAT number → *Supplier invoice · detected*, a merchant without a vendor → *Receipt · detected*) and the chain makes that; no amount read → *What is it?* with the five kinds, the answer types it (`classifyDocument`: the key follows, the model re-reads only when it differs).

The state word (`<DocumentStateLabel>` — the module's one family map, the same word as the library and the review page) shows on a card and in the header for a row not ready. One primary: the chain's (*Accept…* / *Finish it in the form*); without a chain *Run OCR* while the OCR is due, then *From subscription X (2026-10)* (F183), then what the reading proposes. The rest are quiet buttons under the chain.

| State | Actions |
|---|---|
| pending / stuck / failed | **Run OCR** (`o`) — `prepareOcrRerun` puts the document back to `uploaded`, the action queues the job after the commit (`singletonKey` = the document: one run at a time). A completed document is re-run only with `force`, from its review page; corrections are kept. |
| ready, OCR failed | **Expense** (`e`) / **Supplier invoice** (`i`) — financial documents only; a contract or NDA is filed or archived — — the modules' forms pre-filled from the OCR facts as corrected (the expense **docked** beside the open document since F180, as on `/expenses` — the queue folds away while it is open, the document and what it read stay beside it; the supplier invoice a dialog) (`initialFromFacts`, as on the review page), the document pre-selected; **Just file it** (= mark reviewed) |
| ready (financial) | the bank rows that could justify it, top 3 (`SuggestionsSection`), *Link* / *Link to…* (`l`), `Enter` = the top one when HIGH, `1`–`3` = the n-th |
| any inbox row | **Archive** (`d`) |
| archived | **Restore** |
| always | **Open** → the review page |

The preview loads a fresh signed URL per document (`refreshSignedUrlAction`).

## Archive, restore, undo

- `archiveDocuments` / `unarchiveDocuments` (`inbox-writes.ts`): 1 – 50 ids, owner only, a per-id outcome (`archived` / `restored` / `refused` / `missing`). Archive refuses what is not a live inbox row (became, filed, generated, already archived) — archive parks, it is not history (D32). Restore clears `archived_at / archived_by` and nothing else. Each write is audited (`event: archive | restore`).
- The undo stack is the page's (lost on reload), 20 entries, each holding **exactly the ids that succeeded**; `u` / `z` or the bar's *Undo* runs the inverse. An undo whose documents changed meanwhile restores the others and says so.

## The keyboard

Quiet while typing in a field or while a dialog / list is open.

| Key | Owner | Accountant |
|---|---|---|
| `j` `↓` / `k` `↑` | next / previous row, wrapping | ✓ |
| `x` / `a` | tick the open row / all visible or none | — |
| `o` | run the OCR (pending, stuck, failed) | — |
| `e` / `i` | Make it… Expense / Supplier invoice (ready or failed) | — |
| `l` | Link to… (ready, financial) | — |
| `Enter` | accept the chain (F185) — or open its form when it lacks something | — |
| `1`–`3` | link the n-th bank row | — |
| `d` | archive the ticked rows, else the open one (not on Archived) | — |
| `r` | on Archived with ticks: restore them; else refresh | — |
| `u` / `z` | undo the last archive / restore | — |
| `?` | the help (lists only what the role can do) | ✓ |
| `Esc` | close the pane, then clear the ticks (dialogs close themselves) | ✓ |

## Files

`modules/documents/inbox.ts` (state, twins, counts, tabs — `inbox.pure.test.ts` on `specs/documents/fixtures/inbox-state-cases.json`) · `queries.ts` (`listInbox`, `inboxTotals`, `toInboxData`) · `inbox-writes.ts` (archive / restore / OCR re-run — `inbox.test.ts`) · `documents.actions.ts` (`archiveDocumentsAction`, `unarchiveDocumentsAction`, `runOcrAction`, `listInboxAction`) · `components/inbox-workbench.tsx` — the list, the bars, the dialogs (`inbox-workbench.test.tsx` on `inbox-shortcuts.json`), `inbox-pane.tsx` — the open document's two cards (`InboxPane`, *What it is*, *What it read*), `use-inbox-keys.ts` — the key map the help lists and its handler (`INBOX_KEYS`, `isTyping`, `useInboxKeys`), `use-inbox-undo.ts` — the undo stack (`useInboxUndo`, at most `INBOX_UNDO_MAX`, `use-inbox-undo.test.tsx`; F120's cut is this file) — split F67 · `app/(app)/documents/inbox/page.tsx` · `e2e/document-inbox.spec.ts` · screenshots `specs/documents/screenshots/inbox*.png`.

Related: [[document-library]] · [[document-review]] · [[document-upload]] · [[linking]] · [[dashboard]]
