# Document inbox

`/documents/inbox` — the documents work page: every document that still needs a decision on the left, the open one on the right, driven from the keyboard. Spec: `specs/documents/spec.md` US4 (FR-016 – FR-024), decisions D32 / D34. Shaped like the banking inbox ([[linking]]).

```
upload ──► OCR ──► inbox row ──► Make it… Expense / Supplier invoice ──► out (became)
                      │      └─► Just file it (= reviewed) ─────────────► out (filed)
                      │      └─► Enter / 1–3: a bank row justifies it ──► stays until made / filed
                      └─► d archive ──► Archived tab ──► r / u restore ──► back in its pipeline state
```

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

- **All** = Pending + Ready; the title says *{n} documents need attention* — the same number as the library's *Inbox (n)* link and the dashboard's *documents to review* (`inboxTotals`, SC-005).
- **Duplicates** = inbox rows whose bytes (`content_hash`) exist more than once in the tenant (a linked or archived twin counts); the younger ones are captioned *Duplicate of {oldest key}*.
- Counts are over the whole inbox; the search (key, file name, vendor as corrected) and the tab narrow the list only.
- **Scale**: one read of the tenant's non-generated documents per request (cap 20 000, like the library), state / twins / counts in memory. Right for one company; revisit when a tenant passes a few thousand documents ([[lessons]]).
- The accountant sees financial documents only (`can(read, relationship_document)` decides), and nothing he can change.

## The pane

Key, state, file; *Duplicate of* links the oldest twin. Actions by state:

| State | Actions |
|---|---|
| pending / stuck / failed | **Run OCR** (`o`) — `prepareOcrRerun` puts the document back to `uploaded`, the action queues the job after the commit (`singletonKey` = the document: one run at a time). A completed document is re-run only with `force`, from its review page; corrections are kept. |
| ready, OCR failed | **Expense** (`e`) / **Supplier invoice** (`i`) — financial documents only; a contract or NDA is filed or archived — — the modules' dialogs pre-filled from the OCR facts as corrected (`initialFromFacts`, as on the review page), the document pre-selected; **Just file it** (= mark reviewed) |
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
| `Enter` / `1`–`3` | link the top HIGH bank row / the n-th | — |
| `d` | archive the ticked rows, else the open one (not on Archived) | — |
| `r` | on Archived with ticks: restore them; else refresh | — |
| `u` / `z` | undo the last archive / restore | — |
| `?` | the help (lists only what the role can do) | ✓ |
| `Esc` | close the pane, then clear the ticks (dialogs close themselves) | ✓ |

## Files

`modules/documents/inbox.ts` (state, twins, counts, tabs — `inbox.pure.test.ts` on `specs/documents/fixtures/inbox-state-cases.json`) · `queries.ts` (`listInbox`, `inboxTotals`, `toInboxData`) · `inbox-writes.ts` (archive / restore / OCR re-run — `inbox.test.ts`) · `documents.actions.ts` (`archiveDocumentsAction`, `unarchiveDocumentsAction`, `runOcrAction`, `listInboxAction`) · `components/inbox-workbench.tsx` (`inbox-workbench.test.tsx` on `inbox-shortcuts.json`) · `app/(app)/documents/inbox/page.tsx` · `e2e/document-inbox.spec.ts` · screenshots `specs/documents/screenshots/inbox*.png`.

Related: [[document-library]] · [[document-review]] · [[document-upload]] · [[linking]] · [[dashboard]]
