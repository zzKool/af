# Document Library

## Overview

The document library (Story 5.4) provides a paginated, filterable, sortable list of all tenant documents. Owners see all documents and can upload; accountants see financial documents only in read-only mode.

Route: `/documents`

## Architecture

```
page.tsx (Server Component)
  ├─ getDocumentFilterOptions  (parallel prefetch)
  ├─ getTablePreference        (restore cross-session filters)
  └─ DocumentLibraryClient     (Client Component — TanStack Query + Zustand)
        ├─ DocumentStatsBar    (clickable filter chips)
        ├─ DocumentLibraryFilters (search + dropdowns + date range)
        └─ DataTable<DocumentListItem>
```

## Filter Persistence — Dual Layer

| Layer | Scope | Implementation |
|-------|-------|----------------|
| Zustand store | In-session, resets on tenant switch | `useDocumentLibraryStore` via `createTenantStore` |
| DB `table_preferences` | Cross-session | `upsertTablePreferenceAction` (2s debounced write) |

On page load, the Server Component reads `table_preferences` for key `"document-library"` and passes it as `initialPreferences` to the client, which hydrates the Zustand store.

## Filters

- **Search** — `fileName` ILIKE `%query%` (300ms debounce)
- **Status** — multi-select: `pending`, `processing`, `processed`, `failed`
- **Type** — multi-select: `financial`, `relationship`
- **Date range** — `createdAt` between `dateFrom` and `dateTo`

Accountant enforcement: `getDocuments` always adds `documentType = 'financial'` for accountant callers, regardless of the filter input.

## Sorting

Supported sort fields: `businessKey`, `documentType`, `status`, `createdAt`, `fileSize`

Default sort: `createdAt desc`

## Pagination

- Default page size: 25 rows
- Options: 10, 25, 50, 100
- Page size preference saved to `table_preferences`

## Download

Clicking the download icon calls `getDocumentDownloadUrlAction` which generates a SAS URL with `Content-Disposition: attachment; filename="<originalFileName>"`. The client triggers a programmatic `<a download>` click (never `window.open`).

Filename sanitization strips path separators (`/`, `\`) and non-printable characters to prevent path traversal.

### Role-Based Download Access

| Document Type | Owner | Accountant |
|---------------|-------|-----------|
| financial | Download | Download |
| relationship | Download | FORBIDDEN |

## Stats Bar

Clickable stat chips above the filter bar:
- **Total** — all documents (or financial-only for accountant)
- **Needs review** (yellow) — processed but not reviewed
- **OCR failed** (red) — status = `failed`

Clicking a chip applies the corresponding filter to the table.

## Upload Integration

`DocumentUploadZone` is shown only for owners (`role === "owner"`). After a successful upload, it calls `useDocumentLibraryInvalidate()` to refresh the TanStack Query cache (`["documents"]` and `["document-stats"]` keys).

## DataTable Component

The generic `DataTable<TData>` in `src/kernel/ui/data-table.tsx` is a shared component built on `@tanstack/react-table` + `@tanstack/react-virtual`.

Key props:
- `columns` — TanStack column defs (passed from domain)
- `sorting` / `onSortingChange` — controlled sort state
- `page` / `onPageChange` — controlled pagination
- `onPageSizeChange` — optional, renders a rows-per-page selector
- `isLoading` — renders skeleton rows
- `emptyState` — custom empty state slot
- `onRowClick` — optional row click handler
- `virtualizeAbove` — row count threshold for enabling virtualization (default: 50)

The component uses `manualSorting: true` and `manualPagination: true` — all data operations happen server-side.

## Key Files

- `src/modules/documents/documents.ts` — `getDocuments`, `getDocumentFilterOptions`, `getDocumentStats`
- `src/modules/settings/table-preferences.ts` — `getTablePreference`, `upsertTablePreference`
- `src/modules/documents/documents.actions.ts` — `getDocumentsAction`, `getDocumentFilterOptionsAction`, `getDocumentStatsAction`, `getDocumentDownloadUrlAction`
- `src/modules/settings/table-preferences.actions.ts` — `getTablePreferenceAction`, `upsertTablePreferenceAction`
- `src/kernel/storage/storage.ts` — `generateDownloadUrl` (SAS + Content-Disposition)
- `src/app/(app)/documents/page.tsx` — Server Component entry
- `src/modules/documents/components/document-library-client.tsx` — main orchestrator
- `src/modules/documents/components/document-library-filters.tsx` — filter bar
- `src/modules/documents/components/document-stats-bar.tsx` — stats chips
- `src/modules/documents/components/document-upload-zone.tsx` — upload wrapper with cache invalidation
- `src/kernel/ui/data-table.tsx` — generic DataTable
- `src/modules/documents/stores/use-document-library-store.ts` — Zustand filter/sort/page store

## Deletion & Linking Protection

### Hard Delete Flow

Owner-only operation enforced at two layers: `ownerAction` middleware + service role check.

```
Owner clicks delete icon (Trash2)
  ↓
AlertDialog opens — shows document businessKey
  ↓
Owner clicks "Delete"
  ↓
deleteDocumentAction({ documentId })         — ownerAction: RBAC + tenant context
  ↓
deleteDocument(tx, caller, audit, id)
  ├─ status === 'linked' → audit(blocked) → BUSINESS_RULE_VIOLATION
  └─ status !== 'linked' → audit(deleted) → tx.document.delete()
  ↓
[DB transaction commits]
  ↓
getStorage().deleteBlob(extractBlobPath(blobUrl))  — outside transaction
  ├─ success → silent
  └─ failure → logger.warn, orphaned blob (non-fatal)
```

Blob deletion order (AD3): DB record deleted first, blob deleted after commit. If blob deletion fails, the DB record is already gone (authoritative state), and the orphaned blob is logged at `warn` level for admin cleanup.

### Linking Guard

`status === 'linked'` is the permanent, unconditional deletion guard. No time window, no expiry. When a document is linked to a journal entry in Epic 7, its status is set to `"linked"`, making it undeleteable forever.

Error shown to user: `"Cannot delete — document is linked to a journal entry"`

Audit is recorded for **both** outcomes:
- Successful delete: `{ action: 'delete', newData: { outcome: 'deleted' } }`
- Blocked delete: `{ action: 'delete', newData: { outcome: 'blocked', reason: 'linked' } }`

### Role-Based Delete Access

| Role | Delete button visible | Server enforcement |
|------|----------------------|--------------------|
| Owner | Yes (all rows) | `ownerAction` + service role check |
| Accountant | No | N/A (button not rendered) |

### Key Files (Deletion)

- `src/modules/documents/documents.ts` — `deleteDocument()` service
- `src/modules/documents/documents.actions.ts` — `deleteDocumentAction` ownerAction
- `src/modules/documents/components/document-library-client.tsx` — `DeleteButton` with `AlertDialog`

> **Epic 7 note:** Before `tx.document.delete()`, a junction table check must be added once document-transaction linking is implemented.

## Related

- [[document-upload-flow]] — Upload pipeline and status lifecycle
- [[document-review]] — Document review & correction
- [[blob-storage]] — Azure Blob Storage, SAS URL generation, Azurite
- [[zustand-stores]] — Tenant-scoped store pattern
