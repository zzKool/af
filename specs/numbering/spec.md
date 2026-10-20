# Spec — 4.4 numbering: `number_series` + fixed business-key functions

**Problem.** v1 numbered invoices with a 260-line engine and v2 keyed uploads through a per-tenant prefix table with its own settings page. One tenant, one convention (the owner's Excel), zero need for configuration. D5/D6 settle it: fixed functions, one counter table, no settings.

**Scope**
- R1 `number_series(tenant_id, series, next_value)` with RLS; `nextInSeries(tx, caller, series)` is a row-locked upsert in the caller's transaction (concurrent issuers queue; rollback returns the number); `peekSeries` for previews.
- R2 Pure key functions, the owner's conventions verbatim (D21, D28): `VA26-001`, `VA26-QT-001`, `VA26-CN-001`, `InvoiceAF_VA26-001.pdf`, `Ex213-Tr-01`, `Ex213-Tr-01_2026-03-11_`, `SI213-Acc-01`, `SI213-Acc-01_2026-07-24_{vendor slug}`, `exp_20261020_001`; inputs validated; property tests on ordering and padding.
- R3 Documents: provisional upload keys from the fixed function + `doc-yyyy-mm` series; the prefix service, actions, settings tab/page and `DEFAULT_DOCUMENT_TYPE_PREFIXES` removed; the upload form lists the fixed kinds.
- R4 Migration carries `document_key_counters` over so no key is reused. The two obsolete tables are dropped by a **separate migration after the owner's approval** (constitution: ask before dropping data); their models stay, marked deprecated, until then.

**Acceptance**
- [x] 25 concurrent `nextInSeries` → 1..25, no gaps; rollback hands the number back; series per tenant
- [x] existing documents tests pass unchanged in behaviour (same key shape, monthly reset)
- [x] no `Document Prefixes` tab; guard green; docs/numbering.md linked from the index

**Out of scope.** Issuing invoices (H2), expense refs in use (expenses module) — they call these functions.
