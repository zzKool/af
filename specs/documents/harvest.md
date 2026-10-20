# Harvest — documents (H7: Duplicate detection + inbox UX)
Sources read (af_core, commit a2fe220; the checkout has no `.git`, so nothing comes from commits — code only):
`lib/documents/duplicate-entity-detection.ts` (`checkDuplicateEntity`, `checkByPartnerAndInvoiceNumber`, `checkByContentHash`, `checkByFuzzyMatch`) · `app/api/documents/check-duplicate-entity/route.ts` · `app/api/documents/route.ts` POST (upload, hash, 409) · `lib/validation/malware-scanner.ts` (`calculateFileHash`) · `app/api/documents/inbox/route.ts` (`GET`, `getInboxCounts`, `getFilterOptions`) · `types/document-inbox.ts` · `app/dashboard/documents/inbox/page.tsx` + `InboxClient.tsx` (keyboard handler l.771–938, undo l.239–245 / l.679–713, sidebar, shortcuts help) · `app/api/documents/bulk-archive|bulk-restore|bulk-ocr|bulk-link|suggestions/route.ts` · `app/api/documents/[id]/ocr/route.ts` + `__tests__` · `app/api/documents/[id]/create-entity/route.ts` + `__tests__` · `app/api/documents/[id]/reject/route.ts` · `lib/documents/suggestion-engine.ts` (UX parts only) · `lib/documents/document-linking.ts` · `lib/documents/entity-details.ts` · `components/documents/wizard/**` (`DocumentProcessingWizard`, `WizardStepper`, `hooks/useWizardState.ts` + test, `steps/UploadStep.tsx` duplicate branch, `steps/EntityDetailsStep.tsx`, `SupplierMatchCard.tsx`) · `app/api/partners/match/route.ts` (`calculateMatchScore`) · `components/documents/LinkEntityModal.tsx`, `EntityCreationPanel.tsx` · `app/dashboard/documents/queue/QueueClient.tsx` · `lib/validation/documents.ts` + `__tests__/documents.test.ts` · `types/documents.ts` (`calculateOcrQuality`, `DocumentTypeLabels`) · `docs/features/DocumentManagement.md`.
v3 side read: `docs/document-upload.md`, `document-review.md`, `document-library.md`, `docs/linking.md`, `prisma/schema/documents.prisma`, `src/modules/documents/**` (file list).

## 1. What the feature is for (owner's terms)
Receipts, supplier invoices and bank proofs arrive as files, often twice (email + photo, re-upload after a crash, same PDF from two trips). The app must say "you already have this file" at upload time and "this invoice already exists" before an entity is created from it, and let the owner decide. The inbox is the work queue: everything not yet turned into something, sorted by what it needs next (OCR, review, create, link), driven from the keyboard, with undo for the destructive-ish actions (archive).

**What v2/v3 already has** (do not re-harvest): upload + magic-byte validation + business key + async OCR job + status lifecycle `uploaded → processing → extracted/ocr_failed → linked`, review page with corrections overlay and 3-second undo on line-item rows, library with server-side filters/sort/paging and `table_preferences`, stats chips (`Needs review`, `OCR failed`), delete guard when linked, role access. **What v2 lacks and this harvest supplies:** content hash + upload-time duplicate (409 + choice), entity-level duplicate check (exact / hash / fuzzy), the inbox as a work page (queue states, counts, side panel, keyboard, undo stack), archive/restore, "create from document" steps, supplier matching by OCR vendor data, bulk link.

## 2. Behaviour — rules as numbered statements

### 2.1 Duplicate detection — file level (upload)
- R1 At upload, after malware scan, the server computes `contentHash = SHA-256(buffer)` hex and stores it on the document; index `(tenantId, contentHash)`. (`route.ts` l.469–470, l.535; `malware-scanner.ts` l.49–51; `schema.prisma` l.1301, l.1362)
- R2 If a non-deleted document of the same tenant already has that hash and the request has no `?force=true`, the upload is refused with **409** `{ error: 'Duplicate document detected', duplicate: { id, fileName, uploadedAt, uploadedBy, documentType, linkedEntityType, linkedEntityId }, message: 'A document with identical content already exists. Use ?force=true to upload anyway.' }`. Nothing is written to blob or DB. (`route.ts` l.472–510)
- R3 With `?force=true` the file is stored again as a second document with the same hash (v1 allows true duplicates). (`route.ts` l.492)
- R4 The wizard's upload step shows on 409 the amber card `Duplicate Document Detected` / `A document with identical content already exists:` with the existing `fileName`, `Uploaded {date} by {user}`, and `Linked to {entity type}` when linked; two buttons: `Use Existing Document` (continues the wizard with the existing document id, fetching its SAS URL) and `Upload Anyway` (re-posts with `force=true`). The normal upload button is hidden while the card is shown. (`UploadStep.tsx` l.218–226, l.253–270, l.455–503)
- R5 Soft-deleted documents (`deletedAt != null`) never count as duplicates. (`route.ts` l.477)

### 2.2 Duplicate detection — entity level (before "create from document")
- R6 `POST /api/documents/check-duplicate-entity` takes `{ documentId, entityType ∈ SUPPLIER_INVOICE|EXPENSE_CLAIM|COMPANY_PURCHASE, partnerId?, invoiceNumber?, amount?, date? }` and returns `{ hasPotentialDuplicate, duplicates: DuplicateMatch[] }` where a match is `{ type: EXACT_MATCH|CONTENT_HASH|FUZZY_MATCH, confidence: HIGH|MEDIUM|LOW, existingEntityId, existingEntityNumber, existingEntityPartnerId?, existingEntityPartnerName?, existingDocumentId?, reason }`. (`check-duplicate-entity/route.ts` l.20–27; `duplicate-entity-detection.ts` l.17–48)
- R7 Strategy A — **exact**: same tenant, same `partnerId`, same `invoiceNumber` (string equality, case-sensitive, untrimmed), not deleted → one match `EXACT_MATCH / HIGH`, reason `Invoice #{n} from {partner} already exists`. Runs only when both `partnerId` and `invoiceNumber` are given, and only for SUPPLIER_INVOICE. (l.145–186)
- R8 Strategy B — **content hash**: other non-deleted documents of the tenant with the same `contentHash` that already created an entity of the requested type (`linkedEntityId != null AND linkedEntityType = entityType`), max 5; each resolves to its entity → `CONTENT_HASH / HIGH`, reason `This exact document was already used to create Supplier Invoice #{n}` / `… Expense Claim #{n}` / `… Company Purchase #{n}`. Runs for all three entity types; for EXPENSE_CLAIM and COMPANY_PURCHASE it is the only strategy. (l.191–313)
- R9 Strategy C — **fuzzy**: SUPPLIER_INVOICE only, needs `partnerId`, `amount`, `date`; finds supplier invoices of the same partner with `invoiceDate ∈ [date − 7 days, date + 7 days]` and `totalAmount ∈ [amount × 0.99, amount × 1.01]`, max 5 → `FUZZY_MATCH / MEDIUM`, reason `Similar invoice exists: #{n} for {total.toFixed(2)} on {yyyy-mm-dd}`. Constants `FUZZY_AMOUNT_TOLERANCE = 0.01`, `FUZZY_DATE_TOLERANCE_DAYS = 7`. Currency is **not** compared. (l.54–58, l.318–371)
- R10 Results are de-duplicated by `existingEntityId` across strategies (A ⊃ B ⊃ C) and sorted HIGH → MEDIUM → LOW. `LOW` is declared but never produced. (l.91–100, l.121–137)
- R11 The inbox calls the check **without `partnerId`** ("Will be determined during creation"), passing only OCR `invoiceId`, `invoiceTotal ?? total`, `invoiceDate ?? transactionDate`. Consequence: strategies A and C never run from the inbox; only the hash strategy fires. (`InboxClient.tsx` l.448–468)
- R12 The inbox blocks creation only when a **HIGH** match exists: it shows the panel `Possible Duplicate Detected` listing each match as `[HIGH] {reason}` + link `View #{number}` (always to `/dashboard/supplier-invoices/{id}`, even for claims — bug), buttons `Create Anyway` / `Cancel`. MEDIUM-only results proceed silently. (`InboxClient.tsx` l.484–512, l.1536–1580)
- R13 The create-entity endpoint itself performs **no** duplicate check; the only server guard is `Document is already linked to an entity` (400) when `linkedEntityId` is set. (`create-entity/route.ts` l.122–128)
- R14 Partner-level duplicates (same name / org / VAT) are a separate check `POST /api/partners/check-duplicates` (name similarity by Levenshtein ≥ 70 % → low, ≥ 85 % medium, ≥ 95 % high; exact orgNumber/vatNumber/email) — belongs to the partners module, referenced here because the wizard creates partners inline. (`partners/check-duplicates/route.ts` l.64–258)

### 2.3 Inbox — queue states and counts
- R15 Inbox membership = tenant documents, not soft-deleted, `linkedEntityId IS NULL`, `status NOT IN (ARCHIVED, DELETED)`; USER-role callers see only `uploadedBy = own email`, ADMIN/ACCOUNTANT/SUPER_ADMIN see all. (`inbox/route.ts` l.67–77, l.142–150)
- R16 Tabs (`InboxStatus`): `all | pending | ready | duplicates | archived`, labels `All, Pending, Ready, Duplicates, Archived`; default tab `pending`. (`document-inbox.ts` l.9–17)
- R17 `pending` = needs OCR / OCR running / OCR failed: `(ocrProcessed = false AND processingStatus IN (UNPROCESSED, null)) OR processingStatus IN (OCR_PENDING, OCR_PROCESSING) OR (some ocrResult.status = FAILED AND processingStatus != OCR_COMPLETE)`. Sub-state per row: `needs_ocr` (no OCR result at all), `ocr_processing` (latest result PROCESSING), `ocr_failed` (latest FAILED), else `needs_ocr`. (`inbox/route.ts` l.86–111, l.336–348)
- R18 `ready` = `processingStatus = OCR_COMPLETE AND linkedEntityId IS NULL`. (l.113–121)
- R19 `duplicates` = inbox documents whose `contentHash` occurs more than once among the tenant's non-deleted documents (`groupBy contentHash having count > 1`); each such row carries `isPossibleDuplicate = true` and `duplicateOfId/duplicateOfFileName` = the **oldest** document with that hash (`orderBy uploadedAt asc`), omitted when the row is itself the oldest. The duplicate flag is computed for every tab except `archived`. (l.123–132, l.263–318)
- R20 `archived` = `status = ARCHIVED` (any `linkedEntityId`). (l.134–140)
- R21 Counts: `pending`, `ready`, `duplicates` (inbox rows with a repeated hash), `archived`; `total = pending + ready` ("documents need attention"). The `all` tab shows `total`. Counts ignore the active filters. (l.448–523)
- R22 Filters: `documentType` (multi, from `getFilterOptions` distinct), date quick filter `all | today | this_week | this_month | last_30_days` (labels `All Time, Today, This Week, This Month, Last 30 Days`; week starts Sunday: `today − getDay()`), explicit `dateFrom/dateTo` on `uploadedAt`, `search` on `fileName | originalName | ocrData` (contains), `minAmount/maxAmount` parsed but never applied. Sort `date | amount | quality` (labels `Upload Date, Amount, OCR Quality`): `amount` sorts the fetched page in memory on `invoiceTotal || total`, `quality` uses `ocrProcessedAt` as proxy. Page size 50, max 100, cursor = last id → `uploadedAt < cursor.uploadedAt` (ties lost). (l.38–52, l.153–210, l.398–409; `document-inbox.ts` l.97–115, l.187–215)
- R23 OCR considered stuck when the latest result is PROCESSING for more than `OCR_TIMEOUT_MS = 5 min` → row caption `Processing seems stuck`. (`document-inbox.ts` l.218–224)
- R24 OCR quality badge (`calculateOcrQuality`): `High` when `avgConfidence ≥ 0.8 AND populated/fields ≥ 0.7`; `Medium` when `≥ 0.5 AND ≥ 0.5`; else `Low`; shown with `{round(confidence×100)}%`. (`types/documents.ts` l.377–402)
- R25 Suggestions (bank-transaction candidates) are fetched for `ready` rows in batches of ≤ 50 (`POST /api/documents/suggestions`, `minConfidence: 'LOW'`), max 5 candidates per document, displayed top 3; the row badge shows `{HIGH|MEDIUM|LOW} Match` with the reasons as tooltip. Scoring itself = banking harvest H3 (constants in `suggestion-engine.ts` l.74–85: reference 40, exact amount 40, close amount 20, same day 30, within week 15, vendor 25; HIGH ≥ 70 or ≥ 50 with reference, MEDIUM ≥ 40). (`InboxClient.tsx` l.407–445; `suggestions/route.ts` l.21)

### 2.4 Inbox — actions
- R26 Single/bulk **OCR** (`INVOICE` or `RECEIPT` model): bulk ≤ 20 ids, processed sequentially; per-document OCR returns 409 `Document already processed with this model. Use force=true to re-run.` when a COMPLETED result exists and `force` is not set; a FAILED previous result allows re-run; version = max(version)+1 per model. Refresh is scheduled 2 s after start. (`bulk-ocr/route.ts` l.16; `[id]/ocr/route.ts` l.67–82)
- R27 **Archive** (single or bulk ≤ 50): sets `status = ARCHIVED`, skips already-archived (counted as success), USER may only archive own uploads when archiving a single id (`You can only archive documents you uploaded`); event `DOCUMENT_ARCHIVED` with `previousStatus`. (`bulk-archive/route.ts` l.17, l.78–111)
- R28 **Restore** (bulk ≤ 50): only `ARCHIVED` rows change; new status `READY`, or `APPROVED` when `linkedEntityId` is set; non-archived ids count as success. (`bulk-restore/route.ts` l.76–100)
- R29 **Link to entity** (modal, single or bulk ≤ 50): entity type ∈ `BANK_TRANSACTION, SUPPLIER_INVOICE, INVOICE (Client Invoice), EXPENSE_CLAIM`; link type ∈ `SUPPORTING (default) | ORIGINAL | RECEIPT | CORRESPONDENCE`; server validates entity ownership per type; creates `DocumentLink` rows and sets `sourceId` "for backward compatibility". (`LinkEntityModal.tsx` l.29–40; `bulk-link/route.ts`; `document-linking.ts` l.272–318)
- R30 **Create entity** from a `ready` row: duplicate check (R11–R12) then navigation to `/dashboard/documents/{id}?createEntity={type}&from=inbox` — the `createEntity` parameter is **read by nobody**; the detail page shows the creation panel only when the OCR has been approved (`isApproved && !linkedEntityId`). Abandoned direction. (`InboxClient.tsx` l.496; `[id]/page.tsx` l.901–903)
- R31 **Apply suggestion** (`Create & Link`, `Enter`, `1–3`): always creates a SUPPLIER_INVOICE from the OCR data with `autoReconcileToTransaction = candidate.transactionId` (no partner → server answers 400 `Partner is required for supplier invoice`; so from the inbox this only works for documents whose OCR… never carries a partner id — effectively broken). (`InboxClient.tsx` l.515–556; `create-entity/route.ts` l.227–232)
- R32 **Undo**: a client-side stack of `{ action: 'archive'|'restore', documentIds, description }` pushed after every successful archive/restore (single or bulk, `documentIds` truncated to `processed` count — by position, not by result); `z` or the `Undo` button pops the last entry and calls the inverse endpoint (`bulk-restore` for archive, `bulk-archive` for restore); toast `Undone: {description}`; descriptions `Archived {n} document(s)`, `Restored {n} document(s)`, `Archived 1 document`. The stack is lost on reload; OCR, link and create are not undoable. (`InboxClient.tsx` l.239–245, l.616–623, l.679–713, l.751–756)
- R33 Toasts auto-dismiss after 4 s when `success`; errors stay until closed. (l.399–405)
- R34 Infinite scroll via IntersectionObserver (threshold 0.1) on a sentinel below the table; optional auto-refresh every 10 s (flag `autoRefreshEnabled`, never set true — dead). (l.361–397)

### 2.5 Inbox — keyboard (handler ignores events from INPUT/TEXTAREA/SELECT; while the duplicate panel is open only `Escape` works)
| key | action | condition |
|---|---|---|
| `?` | toggle shortcuts help | — |
| `Esc` | close help → cancel duplicate panel → close side panel → clear selection (first that applies) | — |
| `j` / `↓` | focus next row (wraps to first) and open it in the side panel | rows > 0 |
| `k` / `↑` | focus previous row (wraps to last) and open it | rows > 0 |
| `x` | toggle checkbox of focused row | focused |
| `a` | select all visible / deselect all | — |
| `o` | run OCR (INVOICE model) on the open row | row `pending` |
| `i` | create Supplier Invoice from the open row (after duplicate check) | row `ready` |
| `e` | create Expense Claim | row `ready` |
| `l` | open Link modal for selection or open row | selection or open row |
| `d` | archive selection (if any) else the open row | not on `archived` tab |
| `r` | restore selection when on `archived` tab, else refresh list | — |
| `z` | undo last archive/restore | stack not empty |
| `Enter` | apply top suggestion if its confidence is HIGH | row `ready` |
| `1` `2` `3` | apply nth suggestion | row `ready` |
(`InboxClient.tsx` l.771–938; help modal strings l.1727–1785)

### 2.6 "Create from document" — the wizard (`/dashboard/documents/process`, `/dashboard/documents/[id]/process`)
- R35 Steps `upload → review → details → match → done` with labels/descriptions `Upload / Select file & type`, `Review / OCR extraction`, `Details / Entity information`, `Match / Bank transaction`, `Done / Complete`. Visible steps: document type `OTHER` → Upload, Details, Done; entity `EXPENSE_CLAIM` → no Match step; otherwise all five. Entry points `document-first` (default) and `bank-first` (`originTransactionId` pre-fills `linkedTransactionId`); an `existingDocumentId` skips step 0 (starts at step 1 with step 0 completed). (`DocumentProcessingWizard.tsx` l.25–31, l.84–102; `useWizardState.ts` l.96–137)
- R36 Step gating `canProceed(step)`: 0 → document id **and** document type set; 1 → `documentType = OTHER` or `ocrStatus = completed` (Skip OCR sets completed); 2 → a partner (selected, or new-partner with a name) **and** `entityFormData.amount` truthy; 3 and 4 → always. (`useWizardState.ts` l.407–431)
- R37 OCR result pre-fills the form: `amount = invoiceTotal ?? total`, `vatAmount = totalTax`, `currency = currencyCode`, `invoiceNumber = invoiceId`, `date = invoiceDate ?? transactionDate` (ISO day), `dueDate`; later edits in the review step re-sync the same fields. (`useWizardState.ts` l.245–344)
- R38 Entity type default: document type `INVOICE` → `SUPPLIER_INVOICE` (no choice); `RECEIPT` → user chooses `Company Purchase — Corporate expense paid by company` or `Expense Claim — Personal expense to be reimbursed`. (`EntityDetailsStep.tsx` l.32–45, l.124–132)
- R39 Supplier match card: on entering Details, `GET /api/partners/match?name&vatNumber&address&roles=SUPPLIER&limit=5`; score = VAT exact (alnum-normalised, case-insensitive) 100 + name exact 80 | contains 60 | Levenshtein ≤ 3 → `40 − 10·distance` + address contains 20 + 10 per matching role; confidence % = `min(100, round(score/140×100))`; "Best Match ({pct}% confidence)" shown when ≥ 60 %; actions `Use match`, `Create new` (form pre-filled from OCR vendor name/VAT/address), `Search more`. (`SupplierMatchCard.tsx` l.73–99, l.103–130; `partners/match/route.ts` l.55–115)
- R40 Leaving Details creates the partner if new (`POST /api/partners`, roles `[SUPPLIER]`, type COMPANY) then the entity (`POST /api/documents/{id}/create-entity`) with the **edited** OCR values taking precedence (`totalAmount = invoiceTotal ?? total ?? form.amount`, `subtotal`, `vatAmount`, `currency`, `invoiceNumber`, `title = vendorName ?? merchantName`, non-empty line items with `amount > 0`), plus `autoReconcileToTransaction` in bank-first mode. On failure the error is shown and the step does not advance. (`DocumentProcessingWizard.tsx` l.120–248)
- R41 Server create rules: SUPPLIER_INVOICE needs `partnerId` (`Partner is required for supplier invoice`) and an invoice number from override or OCR (`Invoice number is required`); `invoiceDate` defaults to today, `dueDate` to today + 30 days; lines = provided items or one line `{description: title, quantity 1, unitPrice = subtotal}`; status `PENDING`. EXPENSE_CLAIM needs `categoryId` (`Category is required for expense claim`), gets a generated claim number, one line with the total, status `DRAFT`. COMPANY_PURCHASE needs nothing, generated number, status `PENDING`, `merchantName = merchantName ?? vendorName`. Common: `title = title ?? vendorName ?? merchantName ?? fileName`, `currency = … ?? 'SEK'`, `subtotal`/`vatAmount`/`totalAmount` default 0. Then `DocumentLink(ORIGINAL)` + document `linkedEntityType/Id`, `processingStatus = ENTITY_CREATED`, event `ENTITY_CREATED_FROM_OCR`. (`create-entity/route.ts` l.202–429, l.519–535)
- R42 Auto-reconcile (bank-first or suggestion): if the transaction belongs to the tenant it is marked `RECONCILED` with `linkedEntityType/Id`, a payment row with `allocatedAmount = |tx.amount|` and note `Auto-reconciled from document {fileName}` is created per entity type, supplier invoice set `PAID`, company purchase `RECONCILED`, and a second `DocumentLink(RECEIPT)` to the bank transaction is written. (l.431–517)
- R43 Document-first flow links the transaction after creation through `POST /api/banking/transactions/{txId}/reconcile` with `allocatedAmount = form.amount`; failure is non-fatal: `Entity created but bank transaction linking failed. You can link it manually later.` (l.250–277)
- R44 Bug: the wizard stores `entity.id`, but the endpoint returns `entityId` → `createdEntityId` stays undefined; the document-first reconcile step (R43) therefore never runs and "Back" + "Next" re-creates the entity (second call fails with `Document is already linked to an entity`). (`DocumentProcessingWizard.tsx` l.240 vs `create-entity/route.ts` l.537–543)

### 2.7 Document status machine (v1 `lib/validation/documents.ts`, for reference against v3's)
`UPLOADING → READY|DELETED`; `READY → PROCESSING|REVIEWED|APPROVED|ARCHIVED|DELETED`; `PROCESSING → READY|REVIEWED|DELETED`; `REVIEWED → APPROVED|READY|ARCHIVED|DELETED`; `APPROVED → ARCHIVED|DELETED`; `ARCHIVED → READY|DELETED`; `DELETED → ∅`. `REJECTED` is written by `/reject` but absent from the machine (inconsistency). `processingStatus` (`UNPROCESSED, OCR_PENDING, OCR_COMPLETE, ENTITY_CREATED, ARCHIVED`) is a second, orthogonal axis. 45 unit tests cover the transitions.

## 3. Data — the fields that matter
| field | type | meaning | constraints / derived? | v3 note |
|---|---|---|---|---|
| document.content_hash | char(64) | SHA-256 hex of the stored bytes | set once at upload; index (tenant, hash) | **new** column on v2 `Document`; computed in `uploadDocument` after `validateFile` |
| document.duplicate_of_id | uuid? | — | v1 derives it per request (oldest same-hash doc) | derived in `queries.ts`, never stored |
| document.archived_at / archived_by | timestamptz? / uuid? | parked, out of the inbox | v1 used `status = ARCHIVED` | v3: a nullable timestamp, not a status value (statuses are the pipeline; "archived" is a parking flag) |
| document.linked_entity_type/id | string / id | what was created from it | v1 column pair, set by create-entity | v3: **not** a `link` kind (the matrix in `docs/linking.md` has no document → supplier_invoice/expense edge; the payable/expense *owns* its `document_id`). Keep the pair as `became_type` (`supplier_invoice | expense | invoice`) + `became_id` (validated UUID, constitution: cross-module refs are UUIDs), written once by the creating module through `documents.index.markBecame(tx, caller, docId, type, id)`; cleared only when that entity is deleted. The inbox reads it directly — no cross-module query. (Q7) |
| inbox row.inbox_state | enum | `pending.needs_ocr | pending.ocr_processing | pending.ocr_failed | ready | archived` | derived (R17–R20) | derived from v2 `status` (`uploaded`→needs_ocr, `processing`→ocr_processing, `ocr_failed`, `extracted`→ready; `linked` leaves the inbox) + `archived_at` |
| inbox row.is_possible_duplicate | bool | same hash exists elsewhere | derived | same |
| inbox counts | ints | pending, ready, duplicates, archived, total | derived | same, computed server-side, filters ignored |
| duplicate_match | DTO | `{ kind: exact|hash|fuzzy, confidence: high|medium, entityType, entityId, entityNumber, partnerName?, documentId?, reason }` | computed on demand, never stored | same shape, lower-case enums |
| ocr quality | enum | `high|medium|low` (R24) | derived | v2 already has `high|low` (`ocr-processing.md`); keep v2's two levels unless the owner wants three (Q3) |
| link_type (v1 DocumentLink.linkType) | `ORIGINAL|RECEIPT|SUPPORTING|CORRESPONDENCE|GENERATED` | why the document is attached | free | folded into `link.kind` + `link.note` (D18); no separate enum |

Statuses with transitions (v3): pipeline `uploaded → processing → extracted | ocr_failed → linked` (v2, unchanged) + independent flags `archived_at` (set/cleared, both audited) and `reviewed_at` (v2). Inbox membership = not linked and not archived. `REJECTED`/`APPROVED` are not carried over (v2 uses `reviewed_at`).

## 4. Algorithms / formulas

### 4.1 File duplicate (upload)
```
hash = sha256(bytes).hex
existing = first document where tenant = t and content_hash = hash (any status, not hard-deleted)
if existing and not force:
    return 409 with { id, businessKey, fileName, createdAt, createdBy, status, linkedTo? }   -- nothing written
else store; document.content_hash = hash
```
v3 difference: v2 has no soft delete (hard delete + blob removal), so "not deleted" is implicit; the 409 payload returns the business key instead of the raw file name.

### 4.2 Entity duplicate check (before create / before link)
```
input: documentId, targetKind ∈ {supplier_invoice, expense}, partnerId?, invoiceNumber?, amount?, currency?, date?
A exact  (supplier_invoice only, needs partnerId + invoiceNumber):
         supplier_invoice where partner = p and invoice_number = norm(n)      -- norm = trim, collapse spaces, case-fold (v1: raw equality)
         → high
B hash   : documents with same content_hash as the source, other id, having a link to a targetKind entity, take 5 → high
C fuzzy  (supplier_invoice only, needs partnerId + amount + date):
         supplier_invoice where partner = p
           and invoice_date between date − 7d and date + 7d
           and amount between amount × 0.99 and amount × 1.01
           and currency = currency                                         -- v1 did not compare currency; v3 must (CHF vs SEK)
         take 5 → medium
dedupe by entity id in order A, B, C; sort high → medium
```
Expense duplicates (v3 addition, same shape as C): same `payment_source`-agnostic `amount ± 1 %`, `date ± 7 d`, same currency, same partner when known, else same OCR merchant name (case-folded) → medium.

### 4.3 Inbox state and counts (v3 on v2 statuses)
```
in_inbox      = archived_at is null and became_id is null and status != 'linked'
needs_ocr     = status = 'uploaded'
ocr_processing= status = 'processing'  (stuck if updated_at < now − 5 min → caption)
ocr_failed    = status = 'ocr_failed'
ready         = status = 'extracted'
counts        = group by state over in_inbox; duplicates = count of in_inbox rows whose hash count in tenant > 1; archived = archived_at not null
total         = pending + ready
```

### 4.4 Undo stack
```
push { action, ids, label } after a successful archive / unarchive (ids = those reported success, by id, not by position)
undo: pop → call inverse → toast "Undone: {label}"
scope: per page session; cleared on tenant switch; max depth 20
```

### 4.5 OCR quality (v1 three levels, for Q3)
`high` if confidence ≥ 0.80 and populated/fields ≥ 0.70; `medium` if ≥ 0.50 and ≥ 0.50; else `low`.

## 5. UI behaviour worth keeping

### 5.1 Inbox page (work archetype, D19: list left, detail right)
- Header `Document Inbox`, sub `{total} documents need attention`; buttons `⌨ (Keyboard shortcuts (?))`, `Refresh`.
- Tab strip `All (n) · Pending (n) · Ready (n) · Duplicates (n) · Archived (n)`; chip row `Quick filters: All Time · Today · This Week · This Month · Last 30 Days`.
- Columns: checkbox · thumbnail/icon · **Document** (file name, size `· vendor`, amber line `⚠ Duplicate of {fileName}`) · **Type** (label + `Invoice OCR`/`Receipt OCR` chip) · **Extracted Data** (`#{invoiceId}`, `{amount} {currency|SEK}`, date) · **Status** (badge `Needs OCR` amber / `Processing` blue spinner / `OCR Failed` red / `Ready` green / `Archived` grey; quality badge `High 92%`; `⚡ HIGH Match`; `Processing seems stuck`) · **Uploaded** (date + time) · eye icon `View Document`.
- Bulk bar when selection > 0: `{n} selected · Invoice OCR · Receipt OCR · Archive · Link` (on Archived tab: `Restore`), `Undo`, ✕. When nothing is selected and the stack is non-empty: grey bar `↶ Undo: {description}` + `Press Z to undo`.
- Side panel (w-96, sticky): file name, Type, Size, Uploaded, Status; `OCR Extracted Data` box (Vendor / Merchant / Invoice # / Amount / Date); `OCR Error` box; `Matching Transactions` (top 3 cards: confidence chip, `Score: n`, amount+currency, date · account, description, bullet reasons, `Create & Link`); duplicate panel (R12); actions by state: pending → `Run Invoice OCR`, `Run Receipt OCR`; ready → `Create Supplier Invoice`, `Create Expense Claim`, `Create Company Purchase`; always `Link to Entity`, `View Full Details`, `Archive` (not when archived); amber box `This appears to be a duplicate of another document.` + `View Original`.
- Empty states: whole inbox empty → `Great, you're all caught up!` / `No documents need attention right now.` / `Upload Documents →`; tab empty → `No documents in this view` with `No archived documents.` / `No duplicate documents detected.` / `All documents have been processed.`; load failure → `Failed to load inbox` / `There was an error loading the document inbox.` / `Go to Documents →`.
- Toasts: `OCR started ({model})`, `OCR started for {n} documents[, {m} failed]`, `Archived {n} documents[, {m} failed]`, `Restored …`, `Document archived`, `Document linked successfully`, `Created {number} and linked to transaction`, `Undone: {description}`; errors `Failed to fetch documents`, `Failed to start OCR`, `Failed to archive[ documents]`, `Failed to restore`, `Failed to undo action`, `Failed to apply suggestion`, `No OCR data available`.
- Shortcuts help modal: sections `Navigation`, `Selection`, `Actions`, `Suggestions`, `General` (table in §2.5).

### 5.2 Upload duplicate card (R4) — keep as is, with the business key shown.

### 5.3 "Create from document" (v3: replaces wizard + queue + panel with one flow on the review page)
Steps as a stepper inside the review page's right pane (v2 already has the dual-pane review): **1 Review** (v2 corrections overlay) → **2 Make it something**: choice `Supplier invoice (invoice from a supplier, payable)` / `Expense (receipt — company card or private, reclaim)` / `Just file it (bank statement, contract, other)`; supplier match card (R39) with `Use match / Create new / Search`; expense: group + BAS category + paid by; duplicate check (4.2) runs on entering this step and blocks with the panel on `high`, warns inline on `medium` → **3 Link** (optional): top 3 transaction candidates from the linking module, `Skip` → **Done**: `Created {key}` + `Process another` / `Open`. Navigation from the inbox opens the review page at step 2 with the type pre-selected (the thing v1's `?createEntity=` meant to do, R30).

### 5.4 Strings (en/fr) — v1 en strings above; fr to add
| key | en | fr |
|---|---|---|
| inbox.title | Document inbox | Boîte de réception |
| inbox.subtitle | {n} documents need attention | {n} documents à traiter |
| inbox.tab.all / pending / ready / duplicates / archived | All / Pending / Ready / Duplicates / Archived | Tous / En attente / Prêts / Doublons / Archivés |
| inbox.state.needsOcr / processing / ocrFailed / ready / archived | Needs OCR / Processing / OCR failed / Ready / Archived | OCR à lancer / En cours / OCR échoué / Prêt / Archivé |
| inbox.stuck | Processing seems stuck | Le traitement semble bloqué |
| inbox.duplicateOf | Duplicate of {name} | Doublon de {name} |
| inbox.duplicate.panelTitle | Possible duplicate detected | Doublon possible détecté |
| inbox.duplicate.createAnyway | Create anyway | Créer quand même |
| inbox.duplicate.viewOriginal | View original | Voir l'original |
| inbox.undo | Undo: {label} | Annuler : {label} |
| inbox.undo.hint | Press Z to undo | Z pour annuler |
| inbox.undone | Undone: {label} | Annulé : {label} |
| inbox.empty.all | Great, you're all caught up! | Tout est à jour ! |
| inbox.empty.tab | No documents in this view | Aucun document dans cette vue |
| upload.duplicate.title | Duplicate document detected | Document en double détecté |
| upload.duplicate.body | A document with identical content already exists: | Un document au contenu identique existe déjà : |
| upload.duplicate.useExisting | Use existing document | Utiliser le document existant |
| upload.duplicate.uploadAnyway | Upload anyway | Téléverser quand même |
| dup.reason.exact | Invoice #{n} from {partner} already exists | La facture n° {n} de {partner} existe déjà |
| dup.reason.hash | This exact file was already used to create {kind} {key} | Ce fichier a déjà servi à créer {kind} {key} |
| dup.reason.fuzzy | Similar invoice exists: #{n} for {amount} {currency} on {date} | Facture similaire : n° {n} de {amount} {currency} le {date} |

## 6. Tests to port
Fixtures: `fixtures/duplicate-check-cases.json`, `fixtures/inbox-state-cases.json`, `fixtures/ocr-extracted-samples.json`, `fixtures/inbox-shortcuts.json`.

**Duplicate detection (new unit tests, v1 had none for `duplicate-entity-detection.ts`)**
- `upload: same bytes twice → 409 with existing id` (R2) — fixture `file-dup-*`.
- `upload: same bytes with force → second document, same hash` (R3).
- `upload: hash is sha256 hex of the bytes` (from `malware-scanner.test.ts` `calculateFileHash` cases: known-string hash, 64 hex chars, identical buffers equal, different buffers differ).
- `entity: exact partner+number → high` (`exact-hit`); `number differs by case/spaces → high in v3` (`exact-normalised`, v1 would miss).
- `entity: hash match only when the other document created the same kind` (`hash-other-kind` → none).
- `entity: fuzzy within 1 % and 7 days → medium` (`fuzzy-hit`); `amount 1.5 % off → none` (`fuzzy-amount-out`); `8 days off → none` (`fuzzy-date-out`); `same numbers, other currency → none in v3` (`fuzzy-currency`).
- `entity: results deduped by entity id and sorted high first` (`dedupe-order`).
- `entity: expense kind runs hash only (v1) / hash + fuzzy (v3)`.
- `inbox: high match blocks, medium warns` (component test).

**Inbox (new; v1 had none)**
- `state mapping` from v2 status (`inbox-state-cases.json`): uploaded→needs_ocr, processing→ocr_processing, processing older than 5 min→stuck, ocr_failed→ocr_failed, extracted→ready, linked→not in inbox, archived_at set→archived.
- `counts: total = pending + ready; duplicates counts rows with repeated hash; filters ignored`.
- `duplicate_of = oldest document with the hash, null for the oldest itself`.
- `archive: linked document cannot be archived? (v1 allowed; v3: allowed, it just leaves the inbox anyway — decide Q4)`.
- `restore puts the row back in its pipeline state (v1: READY/APPROVED; v3: clears archived_at only)`.
- `undo: archive then z restores exactly the ids that succeeded`.
- `keyboard: j/k wrap, x toggles, a selects all visible, d archives selection else open row, r restores on archived tab else refreshes, Esc order` — component tests with the shortcut fixture.
- `keyboard ignored while typing in an input`.

**Create from document (port from `create-entity/__tests__/route.test.ts`, 23 tests)**
- `400 invalid entity type`; `400 missing required fields`; `404 non-existent document`; `404 other tenant's document`; `400 already linked` (`Document is already linked to an entity`); `400 invalid OCR result`; `400 OCR result of another document`; `supplier invoice created from OCR data` (fixture `ocr-invoice-basic`: vendor Test Supplier, INV-001, 1500.00, tax 300.00, SEK, 2024-01-15, due 2024-02-15); `400 partner missing`; `400 invoice number missing`; `overrides beat OCR`; `expense created with category`; `400 category missing`; `company purchase created` / `without partner` (→ v3: expense paid by company); `link created after entity`; `document updated with entity info` (→ v3: link row exists, status linked); `event logged` (→ audit row); `USER own document ok / other user's forbidden / ADMIN any` (→ v3 roles owner/accountant: accountant read-only → FORBIDDEN).
- From `ocr/__tests__/route.test.ts`: `409 when a completed result exists and no force`; `force re-runs`; `failed previous result allows re-run`; `version increments`.
- From `useWizardState.test.ts` (port the state rules, not the hook): `starts at step 1 when a document exists`; `cannot proceed from upload without document+type`; `cannot proceed from review before OCR completed`; `OTHER type skips OCR`; `details needs partner (or new partner name) and amount`; `OCR result pre-fills amount/vat/currency/number/date/dueDate` (fixture `ocr-invoice-wizard`: 1500.50 / 300.10 / EUR / INV-2024-001 / 2024-01-15 / 2024-02-15); `edited extracted data re-syncs the form`; `reset returns to initial`.
- `partner match scoring` (R39) — 6 cases in `duplicate-check-cases.json#partnerMatch`.
- e2e: upload duplicate → card → `Use existing` lands on the existing document; inbox j/k/d/z round trip.

## 7. Fixtures copied → `specs/documents/fixtures/`
- `duplicate-check-cases.json` — constants (`amountTolerance 0.01`, `dateToleranceDays 7`, `maxMatches 5`), the v1 reason strings, entity-duplicate scenarios with expected kind/confidence, partner-match scoring cases (weights from `partners/match/route.ts`), file-duplicate 409 payload shape.
- `inbox-state-cases.json` — v1 inbox tab/sub-state rules as data + the v3 status mapping, counts example, quick-date-filter definitions, sort options, limits (page 50/max 100, bulk 50, bulk OCR 20, suggestions batch 50, stuck 300 000 ms).
- `inbox-shortcuts.json` — the keyboard table (keys, action, condition, help-modal section and label) from `InboxClient.tsx`.
- `ocr-extracted-samples.json` — the OCR `extractedData` shapes used by the inbox and the tests (`OcrExtractedData` fields; the two test payloads; which field feeds which form field).
- `inbox-strings-en.json` — every user-visible string of the inbox, upload-duplicate card and wizard stepper, keyed as in §5.4 (en only; fr column lives in the table above).

## 8. v3 mapping
- **Keep as is** (feature-inventory §3.9): hash-based duplicate detection, inbox UX (keyboard, undo), document types incl. `bank_statement`, `reimbursement_statement`, `invoice_pdf`.
- **Content hash**: add `content_hash` to v2 `Document`, computed in `documents/upload` after `validateFile`, with the unique-ish index `(tenant_id, content_hash)` (not unique: `force` allows a second copy). 409 → `AppError CONFLICT` with the existing document DTO; `uploadDocumentAction` takes `force?: boolean`. Generated PDFs (`invoice_pdf`, `reimbursement_statement`) also get a hash (regeneration = same bytes → same hash, harmless).
- **Entity duplicate check** moves into the module that creates the entity: `supplier-invoices` (A + B + C) and `expenses` (B + C′); the documents module exposes `findSameContent(tx, documentId): DocumentRef[]` through `index.ts`; the linking module answers "what did that document become" (D18). No `COMPANY_PURCHASE` kind: it is an expense paid from a company account (D9).
- **Inbox** = the documents **work page** (`/documents/inbox`, D19 split panes), built on the kernel `DataTable` (H13) for the list and v2's review components for the pane. Queue states derive from v2 statuses + `archived_at` (4.3); nothing new is stored except `archived_at/by`. Counts and `duplicate_of` in `documents/queries.ts`. Accountant: read-only (no actions, no shortcuts that write).
- **Archive** = `archived_at` flag with audit, undo = clear flag; v1's `ARCHIVED/READY/APPROVED/REJECTED` status juggling is dropped (statuses are the pipeline only).
- **Undo**: client stack (4.4) backed by idempotent server actions `archiveDocuments(ids)` / `unarchiveDocuments(ids)` returning per-id results; v2's 3-second row-undo on the review page stays as is.
- **Create from document** (5.3): one flow on the review page replacing wizard + queue + `EntityCreationPanel` + `?createEntity=`; supplier match card and its scoring go to `partners` (`partners.match(ocrVendor)` via `index.ts`); the transaction candidates step comes from `linking.suggest(documentId)` (H3). `bank-first` entry = the linking work page opening the same flow with the transaction pre-selected.
- **Link to entity modal / bulk link** → the linking module's picker (kinds `justifies` / `belongs_to`); v1 `linkType` values become `link.note` text if needed, not an enum.
- **OCR actions**: `o` runs the v2 job (`processDocumentJob`, singletonKey = documentId); model choice INVOICE/RECEIPT disappears unless v2's OCR exposes it (v2 uses one prebuilt model per kind — check `ocr-processing.md`); 409-on-rerun becomes "re-run" with `force` only from the review page.
- **Kept**: the `Duplicates` tab (cheap, useful). **Dropped**: `minAmount/maxAmount` (never applied), `quality` sort proxy, in-memory amount sort (H13 server sorts), auto-refresh flag, `sourceId` back-compat, `DocumentLink.linkType`, `processingStatus` second axis, `REJECTED`, USER-role scoping (`uploadedBy = me`; v3 roles are tenant-wide), `COMPANY_PURCHASE` as a kind.
- **"What it became"**: `became_type/became_id` on the document (see §3), set by `supplier-invoices` / `expenses` / `invoices` (PDF at issue) through the documents index; `expense.document_id` / `supplier_invoice.document_id` hold the reverse reference. Both are validated UUIDs, not FKs (RLS).
- **Bugs not to port**: R11 (check without partner), R12 (link always to supplier invoice), R30 (`createEntity` unread), R31 (apply suggestion always makes a supplier invoice without partner), R32 (ids truncated by position), R44 (`entity.id` vs `entityId`), fuzzy without currency (R9), week starting Sunday (R22; v3: ISO Monday via `Clock`), status `REJECTED` outside the machine.

## 9. Open questions for the owner

> **Answered 2026-10-20** — the owner\'s answers and the resulting decisions are in `docs/open-questions.md` (B12, D-d → D27, D32). The questions below are kept as the record of what was asked.
- Q1 Upload of an identical file: keep v1's `Upload anyway` (second copy, same hash) or forbid and always reuse the existing document? (Proposal: keep `Use existing` as the primary action and allow `Upload anyway` only for the owner; both audited.)
- Q2 Fuzzy supplier-invoice duplicate: ±1 % amount, ±7 days, same partner, same currency. OK for Vaudoise-scale volumes (a few supplier invoices a month)? Should a recurring subscription (same amount every month, dates 30 days apart) ever be flagged? With 7 days it will not.
- Q3 OCR quality: v2 shows two levels (high/low); v1 had three (high ≥ 80 %/70 % fields, medium ≥ 50 %/50 %, low). Keep two?
- Q4 Archive: should a document that is already linked be archivable (it is out of the inbox anyway)? Proposal: archive is only for inbox rows ("not relevant, park it"); linked documents cannot be archived.
- Q5 Keyboard map: keep v1's letters (`j k x a o i e l d r z ? Enter 1-3`) and add `u` as alias of `z` (ui-conventions says `u` undo)? `i` becomes "make supplier invoice", `e` "make expense"; `c` for "create" is free.
- Q6 Should "Create anyway" on a HIGH duplicate require a note (why it is not a duplicate)? Cheap and useful for the accountant package.
- Q7 "What the document became" is not a link kind in `docs/linking.md`. Proposal: `became_type/became_id` on the document (mirrors v1's `linkedEntityType/Id`) plus `document_id` on the payable/expense — or add a `created_from` kind to the link matrix. The first keeps the inbox query inside the documents module; the second keeps all relationships in one table. Which?
