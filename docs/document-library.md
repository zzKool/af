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

The generic `DataTable<TData>` in `src/components/shared/data-table.tsx` is a shared component built on `@tanstack/react-table` + `@tanstack/react-virtual`.

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

- `src/server/services/documents.ts` — `getDocuments`, `getDocumentFilterOptions`, `getDocumentStats`
- `src/server/services/table-preferences.ts` — `getTablePreference`, `upsertTablePreference`
- `src/server/actions/documents.ts` — `getDocumentsAction`, `getDocumentFilterOptionsAction`, `getDocumentStatsAction`, `getDocumentDownloadUrlAction`
- `src/server/actions/table-preferences.ts` — `getTablePreferenceAction`, `upsertTablePreferenceAction`
- `src/server/services/storage.ts` — `generateDownloadUrl` (SAS + Content-Disposition)
- `src/app/(app)/documents/page.tsx` — Server Component entry
- `src/components/domain/document-library-client.tsx` — main orchestrator
- `src/components/domain/document-library-filters.tsx` — filter bar
- `src/components/domain/document-stats-bar.tsx` — stats chips
- `src/components/domain/document-upload-zone.tsx` — upload wrapper with cache invalidation
- `src/components/shared/data-table.tsx` — generic DataTable
- `src/hooks/use-document-library-store.ts` — Zustand filter/sort/page store

## Related

- [[document-upload-flow]] — Upload pipeline and status lifecycle
- [[document-review]] — Document review & correction
- [[blob-storage]] — Azure Blob Storage, SAS URL generation, Azurite
- [[zustand-stores]] — Tenant-scoped store pattern
