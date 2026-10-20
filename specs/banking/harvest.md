# Harvest — banking (H3: Match scoring rules + fixtures · H4: Learned categorisation / counterparty mappings · H11: Banking: three-account import, transfer pairs, bank fees rule)

Sources read (`/home/claude/af_core`, commit a2fe220):
- H3 — `lib/banking/matching.ts` (`findMatchingCandidates`, six `findXxxMatches` finders, six `scoreXxxMatch` scorers, `DEFAULT_OPTIONS`), `lib/banking/__tests__/matching.test.ts`, `lib/banking/__tests__/fixtures/swedish-test.csv`, `components/documents/wizard/utils/matchScoring.ts` (`calculateMatchScore`, `isGoodMatch`, `detectPartialPayment`, `hasCurrencyMismatch`) + `__tests__/matchScoring.test.ts`, `components/documents/wizard/steps/BankMatchingStep.tsx` (strings), `lib/documents/suggestion-engine.ts` (`findMatchingTransactions`, `scoreTransactionMatch`, `determineConfidence`), `lib/utils/rounding.ts` (+ tests), `app/api/reconciliation/unmatched-entities/route.ts`, `app/api/banking/reconcile-bulk/route.ts`, `app/api/banking/inbox-transactions/route.ts`, `app/api/banking/transactions/[id]/{suggestions,reconcile,reconcile-batch,match,unreconcile,categorize}/route.ts`, `app/api/banking/transactions/{suggestions,bulk-apply,bulk-ignore}/route.ts`, `app/dashboard/banking/inbox/InboxClient.tsx` (keyboard, badges, sort, create-rule modal).
- H4 — `lib/banking/categorization-matcher.ts` (`matchesPattern`, `getFieldValue`, `findMatchingRule`, `fetchTenantRules`, `applyCategorizationRules`, `testPattern`), `lib/banking/categorization-rules.ts` (`getDirectCategorizationSuggestions`, `suggestRuleFromTransactions`, `findLongestCommonSubstring`, `validateCategorizationRule`), `prisma/schema.prisma` model `CategorizationRule` (l. 800–831), `app/api/categorization-rules/{route,[id]/route,test/route,apply/route}.ts`.
- H11 — v3 repo (read-only): `src/modules/banking/csv-parser.ts`, `csv-parser.test.ts`, `__fixtures__/nordea-*.csv`, `docs/csv-parsing.md`, `prisma/schema/banking.prisma` (`BankFormat`, `BankAccount`), `docs/linking.md`, `src/modules/linking/allocation.ts`. v1: `lib/csv/parsers/{nordea,types,index}.ts` + `README.md` + `__tests__/{nordea,index}.test.ts`, `app/api/banking/import-csv/route.ts` (+ `__tests__/route.test.ts`), `app/api/banking/import/route.ts`, `app/api/banking/import/history/route.ts`, models `BankAccount`, `BankTransaction`, `BankImport` (schema l. 669–796). Excel rules: `/home/claude/af/docs/excel-to-v3-mapping.md` Sheet 1.
- Context applied: `docs/feature-inventory.md` D1–D20 (esp. D3, D4, D13, D18, D20, §3.10, §3.12, §3.13), `.claude/skills/bas-accounting/SKILL.md`.

Reading key: **v1 DID** = observed behaviour (cited). **v3 SHOULD** = what the decisions and the Excel make of it (§8). Flags: ⚠ bug · ☠ dead code · ↯ abandoned direction.

---

## 1. What the feature is for (owner's terms)

Three Nordea CSVs a month (SEK main, CHF main, savings once a year) become bank transactions, immutable. Every transaction must end up either **justified** (linked to the invoice, supplier invoice, expense or document it pays — with the amount it covers), **transferred** (one half of a `CHANGE CHFSEK` or a savings move, linked to its other half) or **no document needed** (bank fees, interest, Skatteverket, salary — categorised with a BAS category and flagged). The app proposes the justification (scored suggestions with reasons, HIGH ones applied in one key), remembers what the owner taught it (OPENAI → OpenAI → *Ut*), and never types a status: paid, partially paid, linked are derived from the links.

---

## 2. Behaviour — rules as numbered statements

### H3 — matching (transaction → entity, entity → transaction)

**Candidate search (`findMatchingCandidates`, matching.ts l. 79–143)**
- R1. Candidates are searched for one transaction across six entity types in parallel: client invoice, supplier invoice, expense claim, company purchase, travel allowance, payroll entry (l. 102–116); tenant = `transaction.bankAccount.tenantId` (l. 99).
- R2. Defaults (l. 67–74): `dateTolerance = 5` days, `amountTolerance = 0.01`, `includePartiallyPaid = true`, `minConfidence = 'LOW'`, `allowCrossCurrency = true`, `crossCurrencyTolerance = 0.05`. The per-transaction API accepts `dateTolerance`, `amountTolerance`, `includePartiallyPaid`, `minConfidence` as query params (suggestions/route.ts l. 29–48); the batch API caps `dateTolerance ≤ 30`, `amountTolerance ≤ 0.1`, 50 transactions per call (transactions/suggestions/route.ts l. 17–30).
- R3. Date window: entity date ∈ [bookingDate − 5, bookingDate + 5] (l. 167–170). Travel allowances use [bookingDate − 10, bookingDate + 5] against `departureDate` "since payment may come later than approval" (l. 1225–1230). Entity date per type: invoice `invoiceDate`, supplier `invoiceDate`, expense `claimDate`, purchase `purchaseDate`, allowance `departureDate`, payroll `paymentDate`.
- R4. Status pre-filter: invoice `status ∈ {SENT, OVERDUE, PARTIALLY_PAID}` (`PARTIALLY_PAID` only when `includePartiallyPaid`) (l. 187–191); supplier `APPROVED` and `payments: none` and not soft-deleted (l. 349–358); expense `APPROVED`, no payments (l. 505–514); purchase `DOCUMENTED`, no payments (l. 987–994); allowance `APPROVED`, no payments (l. 1243–1251); payroll `PENDING`, no payments, amount compared to `netAmount` (l. 1504–1522). Max 50 rows per type (`take: 50`).
- R5. ⚠ With the default `allowCrossCurrency = true` there is **no amount pre-filter at all**: the `totalAmount ∈ [|tx|·(1−tol), |tx|·(1+tol)]` clause is added only when `allowCrossCurrency = false` (l. 194–201). So every same-currency entity in the date window is a candidate "amount difference affects score only" (l. 277); `amountTolerance` is effectively unused in the default path.
- R6. Cross-currency candidate (entity currency ≠ transaction currency, l. 236–272): both amounts are converted to the tenant base currency (`getTenantBaseCurrency`) at their own dates (entity date / booking date); kept only if `|entity_base − tx_base| / entity_base ≤ 0.06` (= 0.01 + 0.05); reason `Cross-currency match (converted: CHF→SEK)` is appended. If no rate exists, the entity is kept only when its full number appears in the message (invoice: `message` only; others: `message + ' ' + additionalDetails`), reason `Cross-currency match (currency conversion unavailable)`.
- R7. Ranking: by confidence tier HIGH > MEDIUM > LOW, then score descending (l. 126–134); then filtered by `minConfidence` (l. 137–142). ⚠ The batch endpoint re-sorts by score only and ignores the tier (transactions/suggestions/route.ts l. 108) and returns the top 5 per transaction with `topCandidate` (l. 111–112).
- R8. Error: unknown transaction → throws `Transaction ${id} not found` (l. 95–97).

**Scoring (§4.1 has the full table)**
- R9. Four factors, additive: reference (0–40), amount (10–40), date (5–30, allowance 5–25), currency penalty (−10). Reference search text is lower-cased `message + ' ' + additionalDetails` for client invoices (l. 649–651) and `message + ' ' + recipient + ' ' + additionalDetails` for every other type (l. 761–764 etc.). ⚠ `sender` and `name` are never searched; a refund whose employee name sits in `sender` scores nothing for it (test "employee name in sender field" passes on amount alone).
- R10. A full entity number in the search text is a *strong reference* (+40). A partner / employee / merchant name match is +25 (+30 for allowance and payroll) and also counts as a reference for the confidence rule, except for client invoices where partner name is never checked (l. 638–739).
- R11. Partial invoice number (client invoice only, l. 660–671): split the number on `-` or `_`; keep tokens that are ≥ 3 chars all digits, or > 3 chars and not `inv`, `invoice`, `20xx`; any kept token found → +20 `Partial invoice number match`, not a strong reference. Supplier invoices: any token > 2 chars found → +15 `Partial reference match`, counts as reference (l. 777–787).
- R12. Amount tiers (relative to the **entity** amount, `|tx| − entity| / entity`): < 0.001 → +40 `Exact amount match`; < 0.01 → +30 `Very close amount match`; < 0.05 → +20 `Amount within tolerance`; else +10 `Approximate amount match` (l. 674–693). Payroll wording: `Exact net amount match`, `Very close net amount match`, `Net amount within tolerance`, `Approximate net amount match` (l. 1677–1693).
- R13. Date tiers (fractional days, not floored, l. 695–712): 0 → +30 `Same date`; ≤ 2 → +25 `Within 2 days`; ≤ 5 → +15 `Within 5 days`; else +5 `${floor(days)} days apart`. Payroll: `Same payment date` / `Within 2 days of payment date` / `Within 5 days of payment date` / `${n} days from payment date`. Allowance (vs departure): ≤ 3 → +25 `Within 3 days of departure`; ≤ 7 → +15 `Within week of departure`; ≤ 14 → +10 `Within 2 weeks of departure`; else +5 `${n} days from departure` (l. 1427–1444).
- R14. Currency mismatch: −10 with reason `Currency mismatch (CHF≠SEK)` unless a reference matched, then no penalty and reason `Currency differs but reference matches` (l. 714–723).
- R15. Confidence: `HIGH` if (reference matched and score ≥ 60) or score ≥ 80; `MEDIUM` if ≥ 50; else `LOW` — for invoice, supplier invoice, payroll. Expense claim, purchase, allowance use 75 / 45 instead of 80 / 50 (l. 937–948, 1192–1203, 1456–1467).
- R16. Extra keyword points: allowance `destination` in message +15 `Destination in message`, or `traktamente` / `allowance` +10 `Travel allowance keyword found` (l. 1401–1406); payroll `period` in message +15 `Period reference match`, or `lön` / `salary` / `dividend` / `utdelning` +10 `Payroll keyword found` (l. 1664–1675). Neither counts as a reference.

**Auto-apply vs suggestion**
- R17. Suggestion threshold = `LOW` (everything scored is shown, up to 5). Auto-apply threshold = `HIGH` only; the bulk policy schema allows no other value (`minConfidence: z.enum(['HIGH'])`, bulk-apply/route.ts l. 30). In the inbox `Enter` applies the top candidate only if it is HIGH (InboxClient l. 802–808); `1`–`9` apply the n-th candidate of any confidence (l. 811–819).
- R18. Bulk apply skip reasons (bulk-apply l. 42–50, 126–207): `ALREADY_RECONCILED` (status RECONCILED and fully allocated), `NO_CANDIDATES`, `LOW_CONFIDENCE` (`Best candidate is MEDIUM confidence`), `AMBIGUOUS` when `requireScoreGap` and the top two HIGH scores differ by < 10 (`Top 2 candidates have similar scores (95 vs 90)`), `CURRENCY_MISMATCH` (entity currency ≠ transaction currency — cross-currency is **never** auto-applied), `OVER_ALLOCATION` (nothing left to allocate), `STALE_STATE`. Allocation = `min(remaining on transaction, remaining on entity)` (l. 194–198). Payment note: `Auto-applied from inbox (confidence: HIGH)` (l. 342).

**Reconciliation = allocation (reconcile/route.ts)**
- R19. One transaction may carry several allocations across all seven payment tables; the sum must not exceed `|amount|` → error `Allocation (X) exceeds transaction amount (Y)` (l. 193–211). The entity side must not exceed its total → `Total payments (X) would exceed invoice amount (Y)` (l. 398–403). `allocatedAmount` must be > 0 (`allocatedAmount must be a positive number`, l. 154–159).
- R20. After an allocation the transaction becomes `RECONCILED` when Σ allocations ≥ |amount|, otherwise ⚠ `SUGGESTED` (l. 316) — the same word used for "a rule categorised it" (apply/route.ts l. 120) and for "has candidates"; `isFullyReconciled` and `remainingAmount` are stored (l. 313–322). `remainingAmount` is clamped to 0 when negative within the rounding tolerance (`normalizeToZeroIfWithinTolerance`).
- R21. Entity status after allocation = `determinePaymentStatus(Σ payments, total, currency)` (§4.4): `PAID` when Σ ≥ total or the shortfall ≤ tolerance (CHF 0.05 / SEK 0.50 / EUR 0.05 / USD 0.05), `PARTIALLY_PAID` when 0 < Σ < total − tolerance; the rounding note is appended to the payment note (`Rounding adjustment: CHF 0.03 (Swiss 5-cent rounding tolerance)`).
- R22. Batch reimbursement (reconcile-batch) accepts ≤ 50 items of `EXPENSE_CLAIM | TRAVEL_ALLOWANCE` with explicit `allocatedAmount` each, runs Serializable, same two limits (l. 29–41, 110–113). The `match` route instead does **FIFO by `claimDate` asc** over the chosen claims: each gets `min(remaining, claimAmount)`, fully covered claims become `REIMBURSED` (match/route.ts l. 233–322). The unmatched-entities list also returns expense claims oldest-first "FIFO" (unmatched-entities l. 163).
- R23. ⚠ The `match` route sets the invoice `PAID` and the transaction `RECONCILED` whatever the allocated amount, validates neither limit, and writes `linkedEntityType/Id` (a single-link field that coexists with the multi-payment tables) (match/route.ts l. 111–142, 183–214). ↯ `linkedEntityType/Id` and the payment tables are two competing link models.
- R24. ⚠ `findInvoiceMatches` queries `prisma.invoice` (v1 model) while `bulk-apply`, `reconcile`, `reconcile-bulk` write `invoiceV2` / `invoiceV2Payment` (bulk-apply l. 330, reconcile l. 378): an `INVOICE` candidate found by the engine fails with `Invoice not found` when applied. Abandoned mid-migration (feature-inventory §0 "two invoice models coexist").
- R25. Justification without document (`type: 'JUSTIFICATION'`, reconcile l. 47–53, 682–724): `category ∈ {BANK_FEE, TAX_PAYMENT, INTEREST_INCOME, INTEREST_EXPENSE, OTHER}` + `description` + optional `basAccountId`; stored as `notes_direct = "${category}: ${description}"` and a journal posting; no link row. Direct categorisation (`categorize` route) sets `basAccountId`, `partnerId`, `notes_direct` and marks the transaction `RECONCILED` (l. 80–89); `DELETE` resets to `UNRECONCILED` (l. 169–178). Ignore (`bulk-ignore`) sets `IGNORED` with an optional reason in `notes_direct` (l. 68–80); `r` restores.
- R26. Unreconcile removes one payment link; error when none exists: `No payment link found between invoice ${number} and this transaction` (unreconcile l. 595–602 and siblings).
- R27. Inbox membership (inbox-transactions l. 70–83): `reconciledStatus ∈ {UNRECONCILED, SUGGESTED}` or (`isFullyReconciled = false` and not `IGNORED`); tabs `all | unreconciled | suggested | duplicates | ignored`; counts for each; cursor = `bookingDate|id`; filters on date range, account name(s), currency(ies), amount range, free text over `name, message, sender, recipient, additionalDetails`. ⚠ The free-text `OR` and the cursor `OR` each **overwrite** the membership `OR` (l. 152–159, 165–172): searching or paging drops the inbox filter and returns reconciled rows.

**Document → transaction (reverse direction)**
- R28. `suggestion-engine.ts` finds transactions for an OCR'd document: amount = `invoiceTotal ?? total`, date = `invoiceDate ?? transactionDate ?? today`, reference = `invoiceId ?? invoiceNumber`, vendor = `vendorName ?? merchantName` (l. 158–163); candidates = `UNRECONCILED`, booking date ± 7 days, `|amount|` within ±5 % either sign, newest 50 (l. 180–219). Weights: reference in `message/recipient/additionalDetails` +40 `Invoice reference "X" found in transaction`; amount < 0.1 % +40 `Amount matches exactly: 1234.00`, ≤ 5 % +20 `Amount close: a vs b`; same day +30 `Transaction on same day as invoice`, ≤ 7 days +15 `Transaction N days from invoice date`; vendor full in `message/recipient` +25 `Vendor "X" found in transaction`, any ≥ 3-char word +15 `Partial vendor match: "a, b"` (l. 74–85, 326–418). Confidence: reference and ≥ 50 → HIGH; ≥ 70 HIGH; ≥ 40 MEDIUM; else LOW (l. 82–85, 423–437). Returns max 5 with `topCandidate`. Currency from OCR is read but never scored.
- R29. The document wizard's client-side ranking (`matchScoring.ts`) is a third scorer: amount ≤ 1 % → 100, ≤ 5 % → 50, ≤ 10 % → 25; date ≤ 1 day → 30, ≤ 7 → 20, ≤ 30 → 10; same currency +10; max 140; "good match" ≥ 80; partial payment flagged when the transaction covers < 99 % of the document amount, with `coveragePercent = round(|tx| / entity × 100)` (l. 26–122). Fixture `match-scoring-cases.json`.

### H4 — learned categorisation

- R30. Rule shape (schema l. 800–831; API schema categorization-rules/route.ts l. 27–37): `name` 1–200 chars, unique per tenant (`A rule with this name already exists`, 409); `description` ≤ 500; `matchType ∈ CONTAINS | STARTS_WITH | ENDS_WITH | EXACT | REGEX`; `matchPattern` 1–500 (⚠ `validateCategorizationRule` says ≥ 2 but is ☠ never called); `matchField ∈ name | message | sender | recipient | all`, default `name`; `basAccountId` required and must exist (`BAS account not found`); `partnerId` optional, must belong to the tenant and not be deleted (`Partner not found`); `priority` int 0–999 default 0; `isActive` default true. REGEX patterns are compiled at create/update; invalid → `Invalid regex pattern` 400.
- R31. Matching (`matchesPattern`, matcher l. 48–73): non-regex types compare lower-cased text to lower-cased pattern; `REGEX` runs `new RegExp(pattern, 'i')` on the raw text and an invalid regex silently never matches; empty field text never matches. `matchField = all` joins `name, message, additionalDetails, sender, recipient` with single spaces, empty parts dropped (l. 89–99); an unknown field falls back to `name` (l. 100–102). Note `additionalDetails` is reachable only through `all`.
- R32. Conflict resolution (`findMatchingRule` l. 110–132): active rules sorted by `priority` descending, **first match wins**; equal priority → undefined order (DB `orderBy priority desc` only). No specificity or recency tie-break.
- R33. A rule maps to one BAS account (`ChartOfAccount` — v1's chart is global, not tenant-scoped, categorize/route.ts l. 50–51) and optionally one partner; a hit sets both on the transaction.
- R34. Learning is explicit, never automatic: in the inbox, after the owner picks a category (and optionally a partner, which pre-selects `partner.defaultBasAccountId`, InboxClient l. 1633–1642), a "Create rule" modal opens pre-filled from the current transaction: pattern = `name || sender || recipient`, field = the one that supplied the pattern, type `CONTAINS`, name `Rule: ${pattern.slice(0, 30)}…`, priority 100, partner = the selected one (l. 1644–1655, 1663–1676). The owner may edit pattern, type (`Contains | Exact Match | Starts With | Ends With` — REGEX not offered in the modal), field (`Name | Sender | Recipient | Message | All Fields`), then `Create Rule`. Success toast: `Created rule "${name}" → ${accountNumber} - ${accountName}`.
- R35. Application is on demand, not on import: `POST /api/categorization-rules/apply` with `dryRun` (default false) and `limit` (default 500, max 1000) walks the newest uncategorised transactions (`basAccountId: null`), sets `basAccountId`, `partnerId` and ⚠ `reconciledStatus: 'SUGGESTED'` on hits (apply/route.ts l. 54–125); dry run returns the first 50 matches and `Preview: N transactions would be categorized`, else `Successfully categorized N transactions`; `ruleStats` = hits per rule. Neither import route calls the matcher (import-csv/route.ts, import/route.ts: no reference).
- R36. Rule preview: `POST /api/categorization-rules/test` with `matchType, matchPattern, matchField, limit (default 20, max 100)` tests the pattern against the newest `limit × 5` uncategorised transactions and returns `matchCount, totalTested, matchPercentage, matchingTransactions[≤ limit]` (test/route.ts l. 22–151).
- R37. ☠ Dead: `getDirectCategorizationSuggestions` (would have shown rule hits as HIGH suggestions with reason `Matched rule: ${name}`), `suggestRuleFromTransactions` (longest common substring ≥ 3 chars over selected names → `CONTAINS` on `name`, confidence = share of names containing it; else single distinct sender → `EXACT` on `sender`), `applyCategorizationRules`, `validateCategorizationRule` — defined, never imported. Useful ideas, see §8.
- R38. Excel *Column1* (`date-counterparty`, e.g. `2026-06-02-OPENAI`) is the owner's hand-typed key that groups rows by counterparty for his own lookups; v3 derives `counterparty_key` from the text fields and feeds the rules with it (excel-to-v3-mapping Sheet 1).

### H11 — import, three accounts, transfer pairs, bank fees

**Nordea CSV (v2 `csv-parser.ts`, v3 `docs/csv-parsing.md`, v1 `nordea.ts`)**
- R39. Format: `;` delimiter, `,` decimal, dates `YYYY/MM/DD` in real exports (v1's parser accepted whatever `new Date()` parses and its README claimed `YYYY-MM-DD` — v2 verified the real files), encoding ISO-8859-1 (v1 ⚠ read the file as UTF-8, `import-csv/route.ts` l. 33–34 — å/ä/ö/´ would be mangled; v2 fixed it), UTF-8 BOM stripped if present, header row, trailing `;` on every line, quoted fields may contain `;`.
- R40. Ten columns, in order: `Booking date` · `Amount` · `Sender` · `Recipient` · `Name` · `Additional details` · `Message` · `Own notes` · `Balance` · `Currency`. Semantics (v2 tests + Excel): `Name` = counterparty / card merchant (`KORT KOP LIVSMEDEL AB`, `Skatteverket`, `AVGIFTER NORDEA`); `Message` = structured payment reference (`/ROC/PMT-10026655-5681836`) when the payment carried one; `Additional details` = free text (`Salary January`, `Ränta 2024`, `Priset för juni`); `Sender` filled on incoming rows (and ⚠ holds the *year* on savings-interest rows); `Recipient` on outgoing; `Own notes` = what the owner typed in Nordea; `Balance` = running balance after the row, empty on some card rows; `Currency` per row (`SEK` / `CHF`). ⚠ Corrected by the owner's real July 2026 export (`fixtures/nordea-2026-07-sek-sample.csv`, D25): the header is `Date`; on **card rows `Name` is empty** and the merchant sits in `Additional details` (`Kortköp 260727 OPENAI *CHATGPT SUBS`) and `Message` (`OPENAI *CHATGPT 1234`); `Balance` appears only on the last row of each day.
- R41. Description resolution (v2 l. 91–103): `name` → `details` → `sender` → `"Unknown transaction"`. Reference = `message` trimmed or null. Amount: v2 strips `.` then swaps `,` → `.` and builds a `Decimal` (l. 71–76); v1 stripped whitespace (`-1 500,00` → −1500) and did `parseFloat` (nordea.ts l. 97). Zero amounts: v1's older route rejected them (`Amount cannot be zero`, import/route.ts l. 300–304); v2 accepts.
- R42. Validation errors (v2 l. 116–147, 205–215): `File is empty (0 bytes)`, `File is empty after decoding`, `No data rows found (headers only or empty)`, `Row N: missing required field (date or amount)`, `Row N: invalid amount "x"`, and the formula-injection warning `Row N, column "f": suspicious value starting with formula character` (values starting `=`, `+`, `-` not followed by a digit, `@`) which does not drop the row.
- R43. Account detection (v1 nordea.ts l. 162–213): account number = first match of `/(\d+[\s-]+\d+[\s-]+\d+[\s-]*\d*)/` in the filename (`PLUSGIROKONTO FTG <nnn nn nn-n> - <yyyy-mm-dd hh.mm.ss>.csv`, `SPARKONTO FÖRETAG <nnnn nn nnnnn> - <timestamp>.csv`), spaces collapsed; currency = `CHF` / `SEK` / `EUR` found in the first data line, default `SEK`; account key = `"${number} ${currency}"`; name `Plusgirokonto CHF` / `Sparkonto SEK`; confidence `high`, else `low` with nulls → import error `Could not detect bank account from filename`. The SEK and CHF main accounts share **one Plusgiro number** and are told apart by the Currency column only; `BankAccount` is unique on `(accountNumber, currency)` (schema l. 698) — v3 already has `@@unique([tenantId, accountNumber, currency])`. ⚠ The older route hard-codes the owner's two real account numbers to name them (`import/route.ts` l. 132–148) and auto-creates missing accounts; `import-csv` requires the account to exist (`Bank account not found`, 404).
- R44. Dedup — three generations: (a) v1 `import/route.ts` l. 309–325: exact equality on `(bankAccount, bookingDate, amount, currency, sender, recipient, message)`; (b) v1 `nordea.detectDuplicates` l. 218–245 used by `import-csv`: same calendar date and `|Δamount| < 0.01` and (`|Δbalance| < 0.01` or either balance null); (c) v2 `computeHash` l. 78–89: `sha256(date|amount|reference)` when a reference exists, else `sha256(date|amount|description|rowIndex)`. ⚠ (c) makes the hash of a reference-less row depend on its **position in the file**, so a later export that overlaps the previous one (different start row) re-imports card payments; and two same-day identical rows with the same `/ROC/` reference collide. (b) ignores text entirely but uses balance, which is the one field that distinguishes two identical fees on the same day (fixture `nordea-bank-fee-duplicate-rows.csv`). Duplicates are counted (`duplicateCount`) and skipped, never flagged for review; `isPossibleDuplicate` is ☠ never set true.
- R45. Import record (`BankImport`, schema l. 770–796): file name, import date, `recordCount / successCount / duplicateCount / errorCount`, parser errors in `notes`, blob reference; `import-csv` also stores the CSV as a `Document` of type `BANK_STATEMENT`, source `BANK_IMPORT`, category `Bank Import`, linked to the import (l. 175–206). The last row's balance updates `bankAccount.currentBalance` (l. 165–172). Response: `{ importId, bankFormat, detectedAccount{accountNumber, accountName, currency}, summary{totalRecords, imported, duplicates, errors}, errors[] }`. History endpoint lists imports newest first with account and counts.
- R46. Three accounts (Excel Sheet 1, D13): SEK main (Plusgiro, SEK), CHF main (same Plusgiro, CHF — CHF client invoices are paid here), savings (Sparkonto, SEK). All three are imported the same way; the savings account "only ever carries capital and yearly interest" and its CSV goes to the accountant **once a year** while the two main accounts go monthly — that is what "savings yearly" means. v1 had no notion of this; it is purely an Excel/package rule.
- R47. Transfer pair (Excel Sheet 1 grey italic `CHANGE CHFSEK`): one currency exchange between own accounts shows as **two rows** — a debit on the CHF account and a credit on the SEK account, same booking date, no counterparty — that justify each other; the pair carries the bank's implicit rate (SEK amount / CHF amount), no document is needed. Same for SEK ↔ savings moves (rate 1). v1 had **no** transfer detection (grep for `CHANGE`, `transfer`, `BANK_FEE` finds only the justification enum).
- R48. Bank fees (Excel grey italic `AVGIFTER NORDEA`): categorised *bank fees* with `no_document_needed`; the bank statement itself is the proof. v1 expressed this as a `JUSTIFICATION` of category `BANK_FEE` typed per row (R25) — no rule, no learning.

---

## 3. Data — the fields that matter

### 3.1 Bank account (v1 `BankAccount` l. 669–701 · v2/v3 `BankAccount` + `BankFormat`)

| field | type | meaning | constraints / derived? | v3 note |
|---|---|---|---|---|
| name / account_alias | text | `Plusgirokonto SEK`, `Plusgirokonto CHF`, `Sparkonto Företag` | — | v3 has `account_alias` (optional); seed the three |
| account_number | text | Nordea number as printed in the filename, spaces kept | unique with currency per tenant | v3 as built |
| currency | `SEK` / `CHF` | the account currency; every row's Currency column must equal it | — | **reject** a file whose Currency column ≠ account currency (new, R52) |
| bank_format | FK | `Nordea CSV (Sweden)` config (delimiter, decimal, date format, encoding, column mapping) | app-level library | v3 as built |
| role | enum | `main` / `savings` | new | drives the package rhythm (monthly vs yearly, R46) and transfer-pair detection ("own account") |
| opening_balance / current_balance | Decimal | v1 kept a running `currentBalance` updated from the last imported row | derived | drop — derive from the last imported `balance` when displayed |
| is_primary / iban / bic / bank / notes | — | v1 extras | — | drop except `iban` (printed on invoices, belongs to settings) |

### 3.2 Bank transaction (v1 `BankTransaction` l. 703–768 · v3 — not built yet, `csv-parser.ParsedRow`)

| field | type | meaning | constraints / derived? | v3 note |
|---|---|---|---|---|
| bank_account_id | FK | one of the three | — | |
| bank_import_id | FK | the file it came from | — | keep |
| booking_date | date | Nordea `Booking date` | — | `date`, not timestamptz |
| amount | Decimal(18,2) | signed, negative = out | immutable | truth for the SEK base when the account is SEK (D3) |
| currency | text | `Currency` column | = account currency | |
| balance | Decimal? | running balance | immutable; null allowed | part of the dedup key |
| sender / recipient / name / additional_details / message / own_notes | text? | the six raw text columns, verbatim | immutable | keep all six (v2 `rawFields` keeps all ten) |
| description | text | resolved `name → details → sender → "Unknown transaction"` | derived at import, stored | the display line |
| reference | text? | `message` when it looks like a payment reference | derived | input to matching R10 |
| counterparty_key | text | normalised `description` (upper-case, collapsed spaces, card prefixes `KORT KOP` stripped) | derived at import | Excel *Column1*; input to rules (H4) and the per-partner 360° |
| dedup_hash | text | see R52 | unique per account | |
| row_index | int | position in the file | provenance only | never in the hash |
| v1 `reconciledStatus` (`UNRECONCILED` → `SUGGESTED` → `RECONCILED`, `IGNORED`), `reconciledAt/By`, `isFullyReconciled`, `remainingAmount`, `linkedEntityType/Id` | — | typed statuses | ↯ | **dropped** — derived from `links` (§8.1) |
| v1 `basAccountId`, `partnerId`, `notes_direct` | — | direct categorisation | — | move to `journal_entry` (category, partner, note) — banking → journal (§3.12) |
| v1 `isPossibleDuplicate` | bool | never set | ☠ | drop |
| v1 `notesPublisher`, `notesUpdatedAt`, `TransactionComment` | — | comments | — | comments stay (v1 inbox used them); out of this harvest |

Derived transaction states (read model over `links` + journal flags):

```
unlinked ──justifies/transfer/settles link──► partially_linked ──Σ allocations = |amount|──► linked
    │                                                                         ▲
    └── journal_entry.no_document_needed = true ──────────────────────────────┘ (no link required)
```

### 3.3 Match candidate (v1 `MatchCandidate` l. 38–56 · v3 suggestion read model)

| field | type | meaning | v3 note |
|---|---|---|---|
| entity_type / entity_id / entity_number | linkable type + id + label | what would be linked | from the linkable registry (`summary`) |
| confidence | `HIGH` / `MEDIUM` / `LOW` | tier (R15) | keep three tiers; HIGH = auto-applicable |
| score | int | sum of factors | keep, shown on hover |
| reasons | string[] | the reason strings of §4.1 | i18n keys with params in v3 (`reason.amount.exact`, `reason.date.within{n}`) |
| amount / currency / date / related_party | — | entity facts | from `summary` |
| paid_amount / remaining_amount | Decimal | from existing allocations | from `getAllocationStatus` |
| suggested_allocation | Decimal | `min(tx remaining, entity remaining)` (R18) | new, explicit |

### 3.4 Categorisation rule (v1 `CategorizationRule` l. 800–831)

| field | type | meaning | constraints | v3 note |
|---|---|---|---|---|
| name | text | label | unique per tenant, ≤ 200 | keep |
| description | text? | — | ≤ 500 | keep |
| match_type | enum | `contains` / `starts_with` / `ends_with` / `exact` / `regex` | Postgres enum | keep (regex kept, see §9 Q6) |
| match_pattern | text | the needle | 1–500, regex compiled on save | keep |
| match_field | enum | `name` / `message` / `sender` / `recipient` / `details` / `all` / **`counterparty_key`** | — | add `details` (v1 had no direct way) and `counterparty_key` (default) |
| bas_category_id | FK | BAS category (tenant active set) | required | replaces global chart id |
| partner_id | FK? | partner to set | tenant | keep |
| no_document_needed | bool | a hit flags the entry as justified by the statement | new | fees, interest, Skatteverket, salary (R48) |
| priority | int | higher first | 0–999, default 100 | keep; tie-break added (R56) |
| is_active | bool | — | default true | keep |
| source | enum | `manual` / `learned` | new | learned = created from the inbox correction (R34) |
| hit_count / last_hit_at | int, ts | usage | derived, updated on apply | new, cheap; lets the owner prune |

### 3.5 Bank import (v1 `BankImport` l. 770–796)

| field | type | meaning | v3 note |
|---|---|---|---|
| bank_account_id, file_name, imported_at, imported_by | — | provenance | keep |
| record_count / imported_count / duplicate_count / error_count | int | summary | keep |
| errors | text[] | parser errors | keep as JSON |
| document_id | FK | the CSV stored as document `bank_statement` | keep (v1 `import-csv` did it; the package needs the file, D13) |
| period_from / period_to | date | min/max booking date of the file | new, derived at import — the package picks files by period |

---

## 4. Algorithms / formulas

### 4.1 v1 transaction → entity scoring (one table for the six scorers)

| factor | client invoice | supplier invoice | expense claim | company purchase | travel allowance | payroll entry |
|---|---|---|---|---|---|---|
| search text | `message + details` | `message + recipient + details` | same | same | same | same |
| full number in text | +40 **ref** | +40 **ref** | +40 **ref** | +40 **ref** | +40 **ref** | +40 **ref** |
| name in `recipient` or `message` | — | partner +25 **ref** | claimant +25 **ref** | partner/merchant +25 **ref** | partner +30 **ref** | partner +30 **ref** |
| partial number | +20 (tokens ≥3 digits or >3 chars, not inv/invoice/20xx) | +15 **ref** (tokens >2 chars) | — | — | — | — |
| keyword | — | — | — | — | destination +15 · `traktamente`/`allowance` +10 | period +15 · `lön`/`salary`/`dividend`/`utdelning` +10 |
| amount Δ% vs entity | <0.1 % +40 · <1 % +30 · <5 % +20 · else +10 | same | same | same | same | same, vs `netAmount` |
| date Δ | 0 +30 · ≤2 +25 · ≤5 +15 · else +5 | same | same | same | ≤3 +25 · ≤7 +15 · ≤14 +10 · else +5 | same as invoice |
| currency ≠ | −10 unless ref | same | same | same | same | same |
| HIGH | ref ∧ ≥60 ∨ ≥80 | ref ∧ ≥60 ∨ ≥80 | ref ∧ ≥60 ∨ ≥75 | ref ∧ ≥60 ∨ ≥75 | ref ∧ ≥60 ∨ ≥75 | ref ∧ ≥60 ∨ ≥80 |
| MEDIUM | ≥50 | ≥50 | ≥45 | ≥45 | ≥45 | ≥50 |
| max | 110 | 110 | 110 | 110 | 105 | 110 |

Worked examples (fixture `matching-cases.json`): exact number + exact amount + same day = 110 HIGH; exact amount + same day, no reference = 70 MEDIUM; 0.5 % off + 5 days + no reference = 45 LOW; partial token `042` + exact + same day = 90 HIGH.

### 4.2 v1 cross-currency comparison (R6)

```
tol = amountTolerance + crossCurrencyTolerance = 0.06
e_base = convert(entity.amount, entity.currency → base, entity.date)
t_base = convert(|tx.amount|, tx.currency → base, tx.bookingDate)
keep iff |e_base − t_base| / e_base ≤ tol        (skip when no rate and no full reference)
```

### 4.3 v1 ranking and auto-apply (R7, R17, R18)

```
sort by tier desc, then score desc → filter tier ≥ minConfidence → top 5
auto-apply iff tier = HIGH ∧ entity.currency = tx.currency ∧ (¬requireScoreGap ∨ score₁ − score₂ ≥ 10)
allocation = min(|tx| − Σ tx allocations, entity.total − Σ entity allocations) > 0
```

### 4.4 v1 rounding tolerance and status derivation (`rounding.ts`)

```
tolerance(ccy) = CHF 0.05 | SEK 0.50 | EUR 0.05 | USD 0.05 | else 0.05
shortfall = total − Σ paid
status = PAID            if Σ paid ≥ total
       = PAID (+note)    if 0 < shortfall ≤ tolerance        → paid_amount recorded = total
       = PARTIALLY_PAID  if Σ paid > 0
       = UNPAID          otherwise
tx remaining = |tx| − Σ allocations, clamped to 0 when −tolerance ≤ remaining < 0
```

### 4.5 v1 rule matching (R31–R32)

```
rules = active, ordered priority desc
for r in rules: text = field(tx, r.match_field); if matches(text, r) → return r   (first wins)
matches: exact =  · starts_with · ends_with · contains  on lower(text), lower(pattern)
         regex  new RegExp(pattern,'i').test(text), invalid → false
```

### 4.6 v2 CSV parse (kept for v3, `csv-parser.ts`)

```
decode(ISO-8859-1) → strip BOM → Papa.parse(';', no header mode) → drop header + skipRows
per row: drop trailing '' (trailingDelimiter) → rawFields by column index
         date = YYYY/MM/DD → YYYY-MM-DD ; amount = Decimal(strip '.', ',' → '.')
         currency = col or 'SEK' ; description = name → details → sender → 'Unknown transaction'
         reference = message or null ; balance = Decimal or null
         hash = sha256(date|amount|reference) or sha256(date|amount|description|rowIndex)   ← change, R52
```

### 4.7 v3 transfer-pair detection (new, from R47)

```
for tx a (amount < 0) on own account A, currency cA:
  candidates b on own account B ≠ A, amount > 0, |booking_date(b) − booking_date(a)| ≤ 2 days, not yet linked
  if cA = cB:  pair iff |b.amount| = |a.amount|                      (savings moves, rate 1)
  else:        implied = |b.amount| / |a.amount| (SEK per CHF)
               pair iff |implied / ecb(a.booking_date) − 1| ≤ 0.05   (bank spread + weekend rate)
  text hint (`CHANGE`, `CHFSEK`, `SEKCHF`, `ÖVERFÖRING`, own account number) raises confidence, never required
on accept: link(a, b, kind = 'transfer'); both journal entries no_document_needed = true;
           CHF entry: amount_base = |a| × ecb, rate_source = 'ecb', bank_implicit_rate = implied shown beside it (bas-accounting skill: base from ECB, implicit shown)
```

Worked example (real wording, anonymised, D25): −20 000.00 CHF ↔ +237 740.00 SEK → implied 11.887 (fixtures `nordea-transfer-pair-*.csv`). The earlier mapping figures were randomised, not mistyped (§9 Q1 answered).

---

## 5. UI behaviour worth keeping

**Inbox (`InboxClient.tsx`)** — one list of transactions needing attention, right-hand detail pane, header counts (`N transactions need attention`, `In: +x (n) · Out: −y (n) · Net`), tabs `all / unreconciled / suggested / duplicates / ignored`, sort toggle `By Confidence` (default — HIGH, MEDIUM, LOW, no match, then date desc) / `By Date`, date-group headers, bulk select. Per row: top candidate with a confidence badge (green HIGH, yellow MEDIUM, grey LOW), entity type label, `Enter` hint on HIGH. Keyboard (help modal `?`):

| key | action |
|---|---|
| `↓` / `j`, `↑` / `k` | next / previous transaction |
| `Enter` | apply top candidate **if HIGH** |
| `1`–`9` | apply the n-th candidate |
| `i` / `r` | ignore (with reason) / restore |
| `c` | toggle quick-categorise panel (BAS category + partner + note; choosing a partner pre-selects its default category; "Create rule" from here) |
| `m` | open "match entity" modal (search unmatched entities by type / currency / amount range / partner / text; FIFO list for expense claims) |
| `Esc` | close pane / modal |

Bulk bar: `Apply HIGH matches` (disabled with tooltip `No HIGH confidence matches in selection`), `Ignore`, `Restore`, `Categorize`; result summary `applied / skipped (reason) / failed`. Toasts: `Categorized as 6570 - Bankkostnader`, `Created rule "…" → 6570 - Bankkostnader`, errors `Failed to categorize transaction`, `Failed to create rule`.

**Create-rule modal** — `Create Categorization Rule`; fields `Rule Name` (placeholder `e.g., Spotify Subscription`), pattern (placeholder `e.g., SPOTIFY`), match type select, field select, buttons `Cancel` / `Create Rule` (`Creating...`).

**Document wizard, bank-matching step** — list of candidate transactions sorted by the 140-point score with pills `Good match` (≥ 80) / `Partial (NN%)` / `Different currency`; banners `Currency mismatch — Document: CHF • Transaction: SEK — Exchange rate differences may apply. The reconciliation will proceed with the transaction currency.` and `Partial payment (NN% coverage) — Transaction: x · Document total: y`.

**Import** — drop one or several files; per file: detected bank format, detected account (`Plusgirokonto CHF`), summary `imported / duplicates / errors`, error list; history table (file, account, date, counts).

Strings are English-only in v1 (no fr); v3 writes the keys with en + fr from day one. Suggested keys: `banking.inbox.needAttention`, `banking.suggestion.reason.*`, `banking.import.summary.*`, `banking.rule.create.*`.

---

## 6. Tests to port — one line each

### H3
- `matching: exact amount + same date + number in message` → HIGH, reasons exact/same date/number; fixture `matching-cases.json#inv-exact-same-date`.
- `matching: 0.5 % amount difference` → reason `Very close amount match`, MEDIUM; `#inv-within-1pct`.
- `matching: 3 days before` → `Within 5 days`; `#inv-3-days-before`.
- `matching: 50 % off, no reference` → still a LOW candidate (no amount pre-filter); `#inv-large-amount-diff`.
- `matching: amount boundary exactly 1 % (1010 vs 1000)` → `Very close` (Δ% relative to entity); `#inv-amount-boundary-1pct`.
- `matching: date boundary exactly 5 days` → `Within 5 days`; `#inv-date-boundary-5-days`.
- `matching: partial token 042 in "INV-042"` → +20, HIGH at 90; `#inv-partial-number`.
- `matching: ranking HIGH before MEDIUM regardless of input order` → `#inv-ranking`.
- `matching: tie keeps both at same tier` → `#tie-same-confidence`.
- `matching: supplier name in recipient` → `Supplier name match`, HIGH; `#supplier-name-in-recipient`.
- `matching: cross-entity ranking (supplier with name beats invoice without)` → `#multi-entity-ranking`.
- `matching: expense claim number + claimant in recipient` → HIGH 110; `#expense-claim-number-and-name`.
- `matching: claimant only in sender` → v1 MEDIUM 70 (sender ignored); **v3 must assert the opposite**: sender searched → reference → HIGH; `#expense-name-in-sender-ignored`.
- `matching: minConfidence MEDIUM hides a 45-point LOW` → `#min-confidence-filter`.
- `matching: custom date tolerance 10 includes a 7-day-old invoice` → `#custom-date-tolerance`.
- `matching: unknown transaction` → `NOT_FOUND` AppError (v1 threw).
- `matching: status filters` (PAID invoice, PENDING supplier invoice excluded) → in v3: entity with no remaining amount is not a candidate.
- `bulk apply: skips LOW/MEDIUM, cross-currency, already linked, nothing left; ambiguous when gap < 10` → reasons list R18 (no v1 test existed — write it).
- `allocation: Σ on transaction ≤ |amount|; Σ on entity ≤ total; > 0` → property test (v3 `allocation.pure.test.ts` already covers; add the two-sided case).
- `rounding: CHF 0.01/0.05 within, 0.06 not; SEK 0.25/0.50 within, 0.51 not; overpayment never "within"; exact is not rounding` → `rounding-tolerance-cases.json`.
- `status derivation: PAID / PARTIALLY_PAID / UNPAID incl. 1499.97 vs 1500 CHF` → same fixture.
- `match-scoring (document → transactions): 19 score cases, sort order 2-3-1, input not mutated, good ≥ 80, partial coverage %, currency mismatch` → `match-scoring-cases.json` (becomes the reverse-direction cases of the one v3 scorer).
- `suggestion-engine: reference in recipient counts; vendor partial word ≥ 3 chars = 15; same day 30 / 7 days 15; HIGH with reference at 50` → no v1 test existed; write from R28.
- `inbox query: text search and cursor keep the membership filter` → regression for R27.

### H4
- `rule: contains / starts_with / ends_with / exact are case-insensitive` → `categorisation-rules-sample.json#testPatternCases`.
- `rule: regex is case-insensitive and an invalid regex never matches, never throws` → same.
- `rule: field 'all' joins the five text fields; empty text never matches` → R31.
- `rule: priority desc, first wins; equal priority deterministic (v3: longer pattern, then newest)` → R32/R56.
- `rule: create validates BAS category, tenant partner, unique name (409), regex (400)` → R30.
- `rule: created from inbox correction is prefilled (pattern = name || sender || recipient, CONTAINS, priority 100, source learned)` → R34.
- `rule: test endpoint returns matchCount / totalTested / matchPercentage over newest uncategorised` → R36.
- `rule: apply dry-run changes nothing and previews ≤ 50; apply sets category + partner + no_document_needed; never touches already categorised entries` → R35 minus the `SUGGESTED` write.
- `rule: applied at import on the new rows only` → new (R55).

### H11
- v2 `csv-parser.test.ts` (25 tests: fields, Decimal, ISO dates, 10 raw fields, reference, CHF, interest fallback, negative/positive, empty balance, empty file, headers only, ISO-8859-1 chars, BOM, quoted `;`, hash stable/distinct, alt mapping, validate) → **already in v3**, keep.
- v1 `nordea: thousands separator with space "-1 500,00"` → v3 parser must accept (v2 strips `.` only) — add.
- v1 `nordea: default currency SEK when column empty` → keep.
- v1 `nordea: invalid date / invalid amount reported per row, other rows imported` → keep as `Row N: …` errors.
- v1 `nordea: empty lines skipped` → keep.
- v1 `detectBankAccount: Plusgiro / Sparkonto filename → number + currency from first row; CHF / EUR detected; unknown filename → low confidence` → port as "preselect account from filename" (R53).
- v1 `detectFormat: headers or filename; non-Nordea rejected` → v3: the Nordea format is chosen by the account; a file whose header row ≠ the format's 10 labels is rejected — use `v1-swedish-headers.csv` as the negative case.
- v1 `import-csv: 401 / 403 CSRF / 400 no file / 400 unsupported format / 400 no account in filename / 400 no currency / 404 account not in tenant / tenant isolation / success summary / import record with tenant / duplicates skipped / 400 when nothing parses / 500 on DB error` → port the business ones (file validation, currency ≠ account, dedup, summary, tenant) as service tests.
- `dedup: re-importing the same file imports 0; an overlapping later export imports only the new rows (card rows without reference included)` → fixture `nordea-sek-valid.csv` + a shifted copy (R52).
- `dedup: two identical fee rows same day → both imported (occurrence index 0 and 1); the same file imported again → 0 new rows` → `nordea-bank-fee-duplicate-rows.csv` (D25: balance is not part of the key — it is only present on the last row of a day).
- `transfer pair: CHF −20 000.00 / SEK +237 740.00 same day, 'CHANGE CHFSEK' in details and message → suggested pair, implied 11.887, within 5 % of ECB; both linked 'transfer', both no_document_needed; CHF entry base = ECB` → `nordea-transfer-pair-*.csv`.
- `transfer pair: savings move 50 000 SEK → pair at rate 1` → `nordea-savings-year.csv`.
- `bank fee: AVGIFTER NORDEA row → rule hit → category bank fees, no_document_needed, derived state linked` → `nordea-bank-fee-duplicate-rows.csv`.
- `savings yearly: package for 2026-06 excludes savings CSV; package for 2026-12 (or the year) includes it` → `nordea-savings-year.csv` (lives in exports, listed here because the rule is banking's).

---

## 7. Fixtures copied → `specs/banking/fixtures/`

See `fixtures/README.md`. `matching-cases.json` (20 v1 scenarios as data), `match-scoring-cases.json` (wizard scorer), `rounding-tolerance-cases.json`, `categorisation-rules-sample.json`, `v1-swedish-headers.csv` (verbatim v1 fixture, negative case), and four synthetic Nordea-format files for the rules v1 never had: `nordea-transfer-pair-chf.csv`, `nordea-transfer-pair-sek.csv`, `nordea-bank-fee-duplicate-rows.csv`, `nordea-savings-year.csv`. The v2 Nordea fixtures stay where they are in `src/modules/banking/__fixtures__/`.

---

## 8. v3 mapping — what changes per the decisions

### 8.1 Reconciliation concepts → links / allocations (D18) — the table the brief asks for

| v1 concept | v3 | why |
|---|---|---|
| `InvoicePayment`, `InvoiceV2Payment`, `SupplierInvoicePayment`, `ExpensePayment`, `CompanyPurchasePayment`, `TravelAllowancePayment`, `PayrollPayment` (+ `allocatedAmount`, `currency`, `notes`, `reconciledById`) | **one `link` row**, kind `justifies`, `from = bank_transaction`, `to = invoice / supplier_invoice / expense / document`, `allocated_amount`, `currency`, `note`, `created_by`, audited | D18; DB invariants already in `links_*` checks |
| `reconciledStatus` `UNRECONCILED / SUGGESTED / RECONCILED`, `isFullyReconciled`, `remainingAmount`, `reconciledAt / By` | **dropped**; `unlinked / partially_linked / linked` derived from Σ allocations vs `|amount|` (`getAllocationStatus`); "who/when" = the link's audit row | statuses are derived, never typed (constitution) |
| `SUGGESTED` as a persisted state (three meanings, R20/R35) | **dropped**; suggestions are a read model computed on request and cached per transaction (job after import) | D18 "suggestions … are read models" |
| `IGNORED` + reason | `journal_entry.no_document_needed = true` + `note` (the reason); derived state `linked` | the Excel's grey rows are facts, not a workflow state |
| `JUSTIFICATION {BANK_FEE, TAX_PAYMENT, INTEREST_INCOME, INTEREST_EXPENSE, OTHER}` + `notes_direct` + journal posting | `journal_entry.category` (BAS) + `no_document_needed` + `note`; **no link**; the five enum values become the rules of §3.4 (fees, Skatteverket, interest) and partner defaults | D1/D2: categorise, don't post |
| direct categorisation (`basAccountId`, `partnerId` on the transaction) | `journal_entry.category / partner` — every transaction already has a journal entry (D3, §3.12) | banking → journal boundary |
| `linkedEntityType / linkedEntityId` (single link) | dropped — `links` is many-to-many both ways | duplicate model (R23) |
| `match` route: FIFO over expense claims from one refund | **settlement** (`settles` link to a settlement row with allocations, FIFO proposed, manual override) | D9, feature-inventory §3.7 |
| `reconcile-bulk` (many tx → many invoices atomically) | `createLinks([...])` in one transaction — same validation, partial failure rolls back | keep the capability |
| `reconcile-batch` (one refund → many claims, Serializable) | the settlement again | D9 |
| `unreconcile` | `removeLink` (immutable rows: change = remove + create, both audited) | D18 |
| `determinePaymentStatus` → typed `PAID / PARTIALLY_PAID` on the invoice | derived: `paid` iff `remaining ≤ tolerance`, else `partially_paid` iff Σ > 0; `paid_date` = booking date of the last allocating link (not `now()` as v1 did) | invoices §3.5 "paid amount and delta derived from bank links" |
| per-currency rounding tolerance CHF 0.05 / SEK 0.50 / EUR 0.05 | constants in `kernel/money`, not a setting (a setting exists only when two tenants differ); a short payment inside the tolerance is accepted with one click and the residual is written to category *rounding / exchange difference* by the link service (§9 Q2 for the wider bank-fee tolerance) | 3.13 "tolerance for short payments and bank fees" |
| six finders | one generic finder over the linkable registry (`invoice`, `supplier_invoice`, `expense`, `document`, `settlement`); `COMPANY_PURCHASE` = expense paid from a company account, `TRAVEL_ALLOWANCE` = `per_diem` expense, `PAYROLL_ENTRY` = recurring journal template (categorisation rule, nothing to link) | 3.13 mechanism row; D9, D10; payroll dropped (§3.17) |
| three scorers (matching.ts, suggestion-engine.ts, matchScoring.ts) | **one scorer** run in both directions (transaction → linkables, document/invoice → transactions) with the invoice weights of §4.1: reference 40 (partial 20), partner/claimant name 25, amount 40/30/20/10, date 30/25/15/5, currency −10 unless reference; HIGH = ref ∧ ≥ 60 ∨ ≥ 80, MEDIUM ≥ 50; search text = **all** text fields (`name, message, details, sender, recipient`) | one rule set, one test set |
| cross-currency via live `convertCurrency` | compare `amount_base` (SEK) that both sides already carry (D3), tolerance 6 %; reason `Cross-currency match (CHF→SEK at ECB d.m.yyyy)`; never auto-applied | D3 removes the conversion; R18 kept |
| `allowCrossCurrency = false` path with amount pre-filter | dropped; candidate window = date ± 5 days (± 10 for expense groups whose refund lags), no amount filter, score decides | R5 shows the filter was unused anyway |
| 50-candidate cap per type, top 5 shown | keep 5 shown; cap 50 per type | |
| Enter = apply HIGH, 1–9 = apply n-th, bulk `Apply HIGH` with skip reasons, `requireScoreGap` | keep all; `requireScoreGap` on by default (gap < 10 → ambiguous) | H7 inbox UX keeps the keyboard |
| `@xyflow/react` graph, three payment tables as edges | graph = read model over `links` | D18 |

Allocation invariants already enforced in v3 (`docs/linking.md`): `allocated_amount > 0`, currency = target currency, Σ ≤ target amount. The transaction side (Σ allocations from one transaction ≤ `|amount|`) is **not** yet enforced and must be added when `bank_transaction` registers as linkable (R19 is the v1 precedent).

### 8.2 Categorisation (H4)

- Keep the rule model (§3.4) with three additions: `match_field = counterparty_key` as default, `no_document_needed`, `source ∈ {manual, learned}`; drop nothing. `REGEX` stays only because v1 already validated it on save and it costs nothing — see §9 Q6.
- Apply **at import** on the new rows (after parse, before the journal entries are written) and on demand (`apply` with dry run) — v1 never applied on import (R35), the inventory §3.10 expects "learned categorisation rules (OPENAI → OpenAI, MSFT → Microsoft)" to just work. A hit sets `journal_entry.category`, `partner`, `no_document_needed`; it never sets a status.
- Learning = the v1 modal, prefilled from `counterparty_key` (not raw `name`), one click to confirm (R34); the dead `suggestRuleFromTransactions` idea (longest common substring over a multi-selection) becomes the prefill when several rows are selected.
- Conflict resolution made deterministic: priority desc → longer pattern first → newest first (R32).
- Partner defaults (`partner.default_bas_category`) remain the second source of a category; order: rule hit → partner default → nothing. A partner set by a rule never overrides a partner already set by hand.
- Excel *Column1* → `counterparty_key` derived at import (§3.2); the partner 360° view groups by it.

### 8.3 Import (H11)

- Parser = v2 `csv-parser.ts` unchanged except three edits (D25): (R52) **dedup hash without the row index and without the balance** — `sha256(account | date | amount | currency | sender | recipient | name | additional details | message)`, plus an occurrence index *within the same hash group of the same file* so two truly identical rows on one day stay distinct (fixture `nordea-bank-fee-duplicate-rows.csv`); `Balance` is end-of-day only and `Own notes` is editable in Nordea, so neither is in the key; accept `Date` as well as `Booking date` for the first column (fixture `nordea-2026-07-sek-sample.csv`); and accept a space thousands separator (v1 test).
- (R53) Account choice: the owner picks one of the three accounts; the filename pre-selects it (v1 `detectBankAccount` regex) and the first row's Currency must equal the account currency, else `Currency CHF in file does not match account Plusgirokonto SEK` — nothing is auto-created (v1's older route did).
- Dedup is per account on the hash; duplicates are counted and skipped (v1), never imported as "possible duplicates" (☠ flag dropped).
- Each import stores the CSV as a document `bank_statement` linked `belongs_to` nothing — it is listed by the package builder by `period_from/to` (D13); v1 did this in `import-csv`.
- Every imported row creates its `journal_entry` (D3): SEK account → `amount_base = amount`, `rate = 1`, `rate_source = ecb`; CHF account → ECB of booking date; `bank_implicit_rate` filled when a transfer pair is accepted. Then rules apply (§8.2), then transfer-pair detection (§4.7) and suggestion computation run as a pg-boss job (D17).
- (R54) Transfer pairs: detection per §4.7 as a suggestion of kind `transfer` shown in the inbox with reason `Transfer pair: 9 093.63 CHF ↔ 108 941.69 SEK, implied 11.98 (ECB 11.90)`; accepting creates one `transfer` link and flags both entries `no_document_needed`. Savings moves use the same rule at rate 1.
- (R55) Bank fees: a seeded `learned`-style rule `AVGIFTER NORDEA` → *bank fees*, `no_document_needed`; same for `Ränta` → *interest income*. No per-row justification form (R25 dropped).
- (R46) Savings yearly: `bank_account.role = savings` → the monthly package skips its CSV; the December package (or an explicit "yearly" package) includes the whole year's file(s). Import itself is identical.
- v1's two import routes, parser registry (`detectParser`, `getSupportedBanks`), `BankImport.currentBalance` update, `import/history` → one `importCsv` action + `bank_import` list; the format library is v2's `BankFormat` table (already app-level, no settings UI needed).

### 8.4 Dropped / not carried
Payroll, travel-allowance and company-purchase finders (entities gone); `allowCrossCurrency` option; `SUGGESTED` status; `isPossibleDuplicate`; `linkedEntityType/Id`; per-row `JUSTIFICATION` form; auto-creation of bank accounts from filenames; the Swedish/English header-alias importer (`import/route.ts`); `TransactionComment` is out of this harvest (kept in the workbench spec); the v1 `currency: 'CHF'` literal in the bulk reconcile event log (⚠ wrong, reconcile-bulk l. 212).

---

## 9. Open questions for the owner

> **Answered 2026-10-20** — the owner\'s answers and the resulting decisions are in `docs/open-questions.md` (B7, B8, B9, D-a, D-b → D25, D31). The questions below are kept as the record of what was asked.

1. **Transfer-pair sample is inconsistent.** `docs/excel-to-v3-mapping.md` prints −9 093.63 CHF ↔ +131 271.18 SEK at 11.98, but 131 271.18 / 9 093.63 = 14.44. Which figure is right? (The fixtures use 108 941.69 SEK so that 11.98 holds.) Also: what text does Nordea actually put in `Name` / `Additional details` on a currency exchange between the two Plusgiro accounts — needed to write the text hint of §4.7.
2. **Short-payment tolerance.** v1 only forgave 0.05 CHF / 0.50 SEK. The inventory (§3.13) wants "tolerance for short payments and bank fees" — a foreign bank fee deducted from an incoming CHF payment is 10–30 CHF. Proposal: a short payment is accepted by the owner with one click when `delta ≤ max(0.05 ccy, 0.5 % of the invoice)`; the delta is written to *bank fees* (or *exchange difference* for cross-currency) by the link service, the invoice derives `paid`. Confirm the 0.5 % and the category.
3. **Cross-currency links.** v3 `links` require `allocation currency = target currency`. Does a CHF invoice ever get paid into the SEK account (or an EUR invoice into either)? If never, keep the constraint and let the settlement module alone net in SEK base (D9). If it happens, the allocation must be entered in the invoice currency using the bank implicit rate.
4. **Dedup key.** Is `Balance` always present on the two main accounts' rows (v2 saw it empty on card rows)? Proposal R52 (account, date, amount, balance, name, message + in-file occurrence counter). Alternative: ask Nordea for the transaction id column — does the export offer one?
5. **Savings yearly.** Include the savings CSV in the December package, or offer a separate "year package" (the accountant's year-end)? And is the yearly interest row to be categorised *interest income* automatically (seed rule) — any document needed beyond the statement?
6. **Regex rules.** Keep `REGEX` (v1 had it, validated on save, zero cost) or drop it to stay with the "no engine for a single use" guard? Proposal: keep, hidden behind "advanced" in the modal as in v1.
7. **Rules on import.** Confirm: rules run automatically on every import (v1 did not) and a rule may set `no_document_needed`. And confirm the tie-break (priority → longer pattern → newest).
8. **Transfer-pair thresholds.** Max booking-date gap between the two legs (2 days proposed) and implied-rate tolerance vs ECB (5 % proposed — Nordea's spread on CHF/SEK is ~1–2 %).
