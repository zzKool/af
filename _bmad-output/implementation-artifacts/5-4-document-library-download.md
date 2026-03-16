# Story 5.4: Document Library & Download

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want to browse all my documents in a searchable, filterable list and download any document,
so that I can find and retrieve any business document quickly.

## Acceptance Criteria

1. **Given** documents exist in the system, **When** the owner navigates to `/(app)/documents`, **Then** the document library page uses a `DataTable` component (built on `@tanstack/react-table` 8.21.3, already installed) with Suspense streaming for the initial server fetch
2. **Given** the document library is displayed, **Then** the table shows columns: business key, document type, status, date, vendor/partner, amount — with sortable headers
3. **Given** the document library is displayed, **Then** the owner can filter documents by period (date range), status, document type, and partner — using filter controls above or inline with the table
4. **Given** filters are applied, **When** the owner navigates away and returns within the same session, **Then** filter state is restored from Zustand (client session). **When** the owner logs in on a new session, **Then** the last-used filters are restored from server-side per-user per-table storage
5. **Given** a document row is displayed, **When** the owner clicks the download button/action, **Then** the browser downloads the document in its original format with the original filename (FR8)
6. **Given** documents are displayed, **Then** status badges use correct color semantics: `uploaded`=gray, `processing`=yellow, `extracted`=gray, `ocr_failed`=red, `linked`=green — always with icon + text label (never color alone)
7. **Given** no documents exist, **Then** the empty state shows a descriptive message with upload CTA ("No documents uploaded yet. Drop files here to get started.")
8. **Given** an accountant logs in, **When** they view the documents page, **Then** they see financial documents only in read-only mode — no upload zone, no edit/delete controls, relationship documents are hidden (per Role x Document-Type access matrix)
9. **Given** the documents route group, **Then** an `error.tsx` boundary exists (already created in Story 5.3 — verify it covers the library page)
10. **Given** this story is complete, **Then** `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting any new concepts, patterns, or configurations introduced

## Architectural Decisions

### AD1: DataTable Component — Practical First, Extensible Later
Use `@tanstack/react-table` (8.21.3, already installed) for column definitions, sorting, and filtering state management. Use `@tanstack/react-virtual` (3.13.21, already installed) for row virtualization when row count exceeds 50. This is NOT the full UX-spec `ServerDataTable` with Excel-like column filters — it's a practical, reusable `DataTable` component that future stories can enhance. Start with dropdown/date-range filters above the table, not inline column filters.

### AD2: Server-Side Pagination with Offset
Use offset-based pagination (`skip`/`take`) via Prisma — simpler than cursor pagination and sufficient for document volumes (hundreds, not millions). Page size default: 25. Server returns `{ items, totalCount }` for the table to show pagination controls.

### AD3: Filter Persistence — Dual Layer
- **Client session (Zustand):** `useDocumentLibraryStore` via `createTenantStore` — stores active filters + sort + page. Resets on tenant switch. Survives SPA navigation.
- **Server cross-session:** New `table_preference` DB table — stores per-user per-table JSON preferences. Loaded on initial page mount, written on filter change (debounced 2s). Falls back to defaults if no preference exists.

### AD4: Download via Content-Disposition SAS URL
Enhance `generateSasUrl()` in storage service to accept optional `contentDisposition` parameter. For downloads, generate a SAS URL with `Content-Disposition: attachment; filename="original.pdf"`. Client triggers download via programmatic `<a>` element with `download` attribute (not `window.open` — avoids tab flash). **IMPORTANT: Verify early (Task 3) that Azurite supports `contentDisposition` in SAS tokens.** If it doesn't, fall back to a proxy route (`/api/documents/[id]/download`) that streams the blob with correct headers.

### AD5: Accountant Filtering — Server-Enforced
The `getDocuments` service method applies `WHERE document_type IN ('expense', 'invoice')` for accountant role — not just client-side hiding. This ensures the accountant never receives relationship document data, even via devtools.

### AD6: Existing Documents Page Transformation
Transform the existing `src/app/(app)/documents/page.tsx` from a basic 5-row table into the full library page. Keep the `FileUploadZone` at the top (owner only). Replace the manual HTML table with the new `DataTable` component. The detail page at `[id]/page.tsx` (Story 5.3) remains unchanged.

### AD7: Document Stats Summary Bar
Add a lightweight `getDocumentStats()` service method returning aggregate counts by status and type. Render as a clickable summary bar above the table: "47 documents | 12 need review | 3 OCR failed". Each stat chip acts as a filter shortcut — clicking it applies the corresponding filter. Low cost (one `GROUP BY` query), high signal, and pre-builds the data pipeline Epic 8's dashboard needs.

### AD8: DataTable Column Metadata for Future Density Modes
Column definitions include `meta: { compactHidden?: boolean }` on columns that would hide in a future compact/mobile density mode. Don't build the toggle in this story — just design the column defs so TanStack Table's `columnVisibility` can flip them later at zero cost.

## Tasks / Subtasks

- [x] Task 0: Prisma migration — add TablePreference model for filter persistence (AD3)
  - [x] 0.1 Add to `prisma/schema/app.prisma`:
    ```prisma
    model TablePreference {
      id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
      userId    String   @map("user_id") @db.Uuid
      tableKey  String   @map("table_key") @db.VarChar(50)
      preferences Json   @map("preferences") @db.JsonB
      createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
      updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz

      @@unique([userId, tableKey])
      @@map("table_preferences")
    }
    ```
    - NOT tenant-scoped (like UserPreference) — controlled by userId from auth context
    - `tableKey` examples: `"documents"`, `"journal"`, `"partners"` — reusable for all future tables
    - `preferences` JSONB stores: `{ filters, sortBy, sortDirection, pageSize }`
  - [x] 0.2 Run `npx prisma migrate dev --name add-table-preferences`
  - [x] 0.3 Verify migration SQL — ensure no RLS policy needed (userId-scoped, not tenant-scoped)

- [x] Task 1: Create table preference service (AD3)
  - [x] 1.1 Create `src/server/services/table-preferences.ts`:
    ```typescript
    export async function getTablePreference(
      prisma: PrismaClient, userId: string, tableKey: string
    ): Promise<TablePreferenceData | null>

    export async function upsertTablePreference(
      prisma: PrismaClient, userId: string, tableKey: string, preferences: Record<string, unknown>
    ): Promise<ServiceResult<TablePreferenceData>>
    ```
    - Uses raw PrismaClient (not tenant-scoped tx) since this is user-scoped, not tenant-scoped
    - Upsert on unique(userId, tableKey) — idempotent
  - [x] 1.2 Create server actions in `src/server/actions/table-preferences.ts`:
    - `getTablePreferenceAction` — authedAction (uses ctx.callerIdentity.userId)
    - `upsertTablePreferenceAction` — authedAction with debounced writes from client

- [x] Task 2: Enhance document service with paginated query (AD2, AD5)
  - [x] 2.1 Add `getDocuments()` to `src/server/services/documents.ts`:
    ```typescript
    export interface DocumentFilters {
      status?: string[];         // e.g., ["extracted", "ocr_failed"]
      documentType?: string[];   // e.g., ["expense", "invoice"]
      prefixType?: string[];     // e.g., ["expense", "invoice", "contract"]
      dateFrom?: string;         // ISO date
      dateTo?: string;           // ISO date
      search?: string;           // search businessKey, fileName
    }

    export interface DocumentSort {
      field: 'businessKey' | 'documentType' | 'status' | 'createdAt' | 'fileSize';
      direction: 'asc' | 'desc';
    }

    export async function getDocuments(
      tx: TransactionClient,
      caller: CallerIdentity,
      filters: DocumentFilters,
      sort: DocumentSort,
      pagination: { page: number; pageSize: number },
    ): Promise<ServiceResult<{ items: DocumentListItem[]; totalCount: number }>>
    ```
    - **Accountant enforcement (AD5):** If `caller.role === 'accountant'`, force `documentType IN ('expense', 'invoice')` regardless of filter input — server-enforced, not client-trusting
    - `search` uses `ILIKE` on `businessKey` and `fileName` — sufficient for this scale
    - Returns `DocumentListItem` (lighter than full `DocumentReviewData`): `{ id, businessKey, fileName, prefixType, documentType, status, createdAt, fileSize, reviewedAt, extractedVendor, extractedAmount, extractedCurrency, extractedDate }`
    - `extractedVendor`, `extractedAmount`, etc. are computed from `resolveDocumentData(ocrData.extractedData, corrections)` — show corrected values in the list
    - Default sort: `createdAt DESC`
  - [x] 2.2 Add `getDocumentFilterOptions()` to service — returns distinct values for filter dropdowns:
    ```typescript
    export async function getDocumentFilterOptions(
      tx: TransactionClient,
      caller: CallerIdentity,
    ): Promise<ServiceResult<{ statuses: string[]; documentTypes: string[]; prefixTypes: string[] }>>
    ```
    - Accountant enforcement: only returns financial document types
    - Distinct values from actual data (not hardcoded enums) — shows only what exists
  - [x] 2.3 Add `getDocumentStats()` to service (AD7):
    ```typescript
    export async function getDocumentStats(
      tx: TransactionClient,
      caller: CallerIdentity,
    ): Promise<ServiceResult<{
      totalCount: number;
      byStatus: Record<string, number>;
      byType: Record<string, number>;
      unreviewed: number;
    }>>
    ```
    - Single `GROUP BY` query — lightweight aggregate
    - Accountant enforcement: only counts financial documents
    - `unreviewed` = count where `status IN ('extracted', 'ocr_failed') AND reviewed_at IS NULL`

- [x] Task 3: Enhance storage service for download (AD4)
  - [x] 3.1 Update `generateSasUrl()` in `src/server/services/storage.ts` to accept optional `contentDisposition` parameter:
    ```typescript
    export async function generateSasUrl(
      blobPath: string,
      expiresInMinutes: number,
      options?: { contentDisposition?: string },
    ): Promise<string>
    ```
    - When `contentDisposition` is provided, include it in the SAS token via `BlobSASQueryParameters`
    - Use `contentDisposition: 'attachment; filename="original-name.pdf"'` for downloads
  - [x] 3.2 Add `generateDownloadUrl()` convenience method:
    ```typescript
    export async function generateDownloadUrl(
      blobPath: string,
      originalFileName: string,
      expiresInMinutes: number = 5,
    ): Promise<string>
    ```
    - Wraps `generateSasUrl` with `Content-Disposition: attachment; filename="${sanitizedFileName}"`
    - Sanitize filename for HTTP header safety (no quotes, no path traversal)
  - [x] 3.3 **EARLY VALIDATION:** Test `generateDownloadUrl` against Azurite to verify `contentDisposition` SAS support:
    - Generate a SAS URL with content-disposition against local Azurite
    - HTTP GET the URL and verify the `Content-Disposition` response header is present
    - If Azurite doesn't support it: implement fallback proxy route at `src/app/api/documents/[id]/download/route.ts` that streams the blob with correct headers
    - **Do this BEFORE building the client download handler** — discover the constraint early, not during smoke testing

- [x] Task 4: Create document library server actions (AC: #1-#5, #8)
  - [x] 4.1 Add `getDocumentsAction` to `src/server/actions/documents.ts`:
    ```typescript
    const documentsQuerySchema = z.object({
      filters: z.object({
        status: z.array(z.string()).optional(),
        documentType: z.array(z.string()).optional(),
        prefixType: z.array(z.string()).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        search: z.string().max(200).optional(),
      }).optional(),
      sort: z.object({
        field: z.enum(['businessKey', 'documentType', 'status', 'createdAt', 'fileSize']),
        direction: z.enum(['asc', 'desc']),
      }).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(10).max(100).default(25),
    });
    ```
  - [x] 4.2 Add `getDocumentFilterOptionsAction` — returns distinct filter values
  - [x] 4.3 Add `getDocumentStatsAction` — returns aggregate counts for summary bar
  - [x] 4.4 Add `getDocumentDownloadUrlAction`:
    ```typescript
    const downloadSchema = z.object({ documentId: z.string().uuid() });
    ```
    - Role check: owner sees all, accountant sees financial only
    - Returns `{ downloadUrl: string }` — client opens in new tab
    - Uses `generateDownloadUrl()` with original `fileName`

- [x] Task 5: Create reusable DataTable component (AD1, AC: #1, #2)
  - [x] 5.1 Create `src/components/shared/data-table.tsx` — `"use client"`:
    - Generic `DataTable<TData>` component using `@tanstack/react-table`
    - Props: `columns: ColumnDef<TData>[]`, `data: TData[]`, `totalCount: number`, `page: number`, `pageSize: number`, `sorting: SortingState`, `onSortingChange`, `onPageChange`, `isLoading: boolean`
    - Uses existing `<Table>` primitives from `src/components/ui/table.tsx`
    - Sortable column headers with sort direction indicator (chevron up/down)
    - Pagination controls at bottom: prev/next + page indicator ("Page 1 of 4") + page size selector
    - Loading state: skeleton rows (3-5 rows) matching column structure
    - Empty state slot: `emptyState?: ReactNode` — rendered when `data.length === 0 && !isLoading`
    - Row click handler: `onRowClick?: (row: TData) => void`
    - Row actions slot: last column for action buttons (download, review link)
    - **Virtual scrolling**: Enable via `@tanstack/react-virtual` when `data.length > virtualizeAbove` — configurable prop, default `50`. Plain DOM rendering below threshold.
    - **Column meta (AD8):** Support `meta: { compactHidden?: boolean }` on column defs for future density mode toggle. Don't build the toggle — just pass the meta through.
  - [x] 5.2 Create `src/components/shared/data-table.test.tsx`:
    - Renders columns and rows
    - Sort click toggles direction
    - Pagination controls work
    - Empty state renders
    - Loading skeleton renders
    - Row click fires handler

- [x] Task 6: Create document library filter components (AC: #3)
  - [x] 6.1 Create `src/components/domain/document-library-filters.tsx` — `"use client"`:
    - Filter bar above the table with:
      - **Status filter:** Multi-select dropdown (checkboxes) — values from `getDocumentFilterOptions`
      - **Document type filter:** Multi-select dropdown — values from server
      - **Period filter:** Date range picker (from/to) — native date inputs for simplicity
      - **Search:** Text input with debounce (300ms) — searches businessKey + fileName
    - "Clear all filters" ghost button when any filter is active
    - Active filter count badge
    - Fires `onFilterChange(filters: DocumentFilters)` callback
  - [x] 6.2 Create Zustand store `src/hooks/use-document-library-store.ts`:
    ```typescript
    interface DocumentLibraryStore {
      filters: DocumentFilters;
      sort: DocumentSort;
      page: number;
      pageSize: number;
      setFilters: (filters: Partial<DocumentFilters>) => void;
      setSort: (sort: DocumentSort) => void;
      setPage: (page: number) => void;
      setPageSize: (pageSize: number) => void;
      clearFilters: () => void;
    }
    export const useDocumentLibraryStore = createTenantStore<DocumentLibraryStore>({
      filters: {},
      sort: { field: 'createdAt', direction: 'desc' },
      page: 1,
      pageSize: 25,
      // ... actions
    });
    ```
    - Uses `createTenantStore` — auto-resets on tenant switch
    - Changing filters resets page to 1

- [x] Task 7: Create document library page (AC: #1-#8)
  - [x] 7.1 Transform `src/app/(app)/documents/page.tsx`:
    - **Server Component** fetches initial data via `getDocumentsAction` + `getDocumentFilterOptionsAction` + `getTablePreferenceAction`
    - Passes initial data to client component
    - Suspense boundary wraps the data-dependent section
    - `FileUploadZone` stays at top (owner only — hidden for accountant via `caller.role` check)
  - [x] 7.2 Create `src/components/domain/document-library-client.tsx` — `"use client"`:
    - Orchestrates: summary bar + filters + DataTable + pagination
    - Initializes Zustand store from server-side table preference (cross-session restore)
    - Uses TanStack Query (`useQuery`) for data fetching on filter/sort/page change:
      ```typescript
      const { data, isLoading } = useQuery({
        queryKey: ['documents', filters, sort, page, pageSize],
        queryFn: () => getDocumentsAction({ filters, sort, page, pageSize }),
        placeholderData: keepPreviousData, // stale-while-revalidate feel
      });
      ```
    - On filter/sort change: debounced (2s) write to server via `upsertTablePreferenceAction`
    - Column definitions for document table:
      - **Business Key** — link to `/documents/{id}` (clickable)
      - **Document Type** — badge with prefixType label
      - **Status** — colored badge with icon + text (AC #6)
      - **Date** — formatted per user locale (from `extractedDate` or `createdAt` fallback)
      - **Vendor/Partner** — from resolved `extractedVendor` (corrections override OCR)
      - **Amount** — from resolved `extractedAmount` + `extractedCurrency`
      - **Actions** — download button + review link (if status is `extracted`/`ocr_failed`)
    - Row click → navigate to `/documents/{id}`
    - Download button → calls `getDocumentDownloadUrlAction` → creates invisible `<a>` element with `download` attribute, clicks it programmatically, removes it. **DO NOT use `window.open` — causes tab flash.**
    - **Cache invalidation:** After successful upload (FileUploadZone onSuccess), call `queryClient.invalidateQueries({ queryKey: ['documents'] })` to refresh the table. Without this, newly uploaded docs won't appear until manual refresh.
  - [x] 7.2a Create `src/components/domain/document-stats-bar.tsx` — `"use client"` (AD7):
    - Renders summary stats from `getDocumentStatsAction`:
      ```
      ┌─────────────────────────────────────────────────────────────┐
      │  47 documents  │  12 need review  │  3 OCR failed           │
      └─────────────────────────────────────────────────────────────┘
      ```
    - Each stat chip is clickable — applies corresponding filter to the Zustand store
    - Clicking "12 need review" → sets `filters.status = ['extracted'], reviewedAt = null` (or closest approximation)
    - Clicking "3 OCR failed" → sets `filters.status = ['ocr_failed']`
    - Fetched separately with `useQuery({ queryKey: ['document-stats'], staleTime: 30_000 })` — doesn't refetch on every filter change, only on upload/mutation
    - Hidden for accountant if no financial documents exist
  - [x] 7.3 Status badge component — inline in column definition or extracted to helper:
    ```typescript
    const STATUS_CONFIG: Record<string, { color: string; icon: LucideIcon; label: string }> = {
      uploaded:   { color: 'bg-muted text-muted-foreground', icon: Upload, label: 'Uploaded' },
      processing: { color: 'bg-yellow-100 text-yellow-800', icon: Loader2, label: 'Processing' },
      extracted:  { color: 'bg-muted text-muted-foreground', icon: FileCheck, label: 'Extracted' },
      ocr_failed: { color: 'bg-red-100 text-red-800', icon: AlertCircle, label: 'OCR Failed' },
      linked:     { color: 'bg-green-100 text-green-800', icon: Link2, label: 'Linked' },
    };
    ```
    - Review sub-badge: if `status === 'extracted'` and `reviewedAt !== null` → "Reviewed" (green); if `reviewedAt === null` → "Needs Review" (yellow)
  - [x] 7.4 Empty state component (AC #7):
    - "No documents uploaded yet. Drop files here to get started." + link/button to scroll to upload zone
    - For filtered empty: "No documents match your filters." + "Clear all filters" button
    - For accountant empty: "No financial documents have been uploaded for this period yet. The business owner will upload documents as they arrive."
  - [x] 7.5 Accountant mode (AC #8):
    - Hide `FileUploadZone` entirely
    - Hide delete/edit action buttons in table rows
    - Hide relationship document types from filter options (server already enforces, but UI shouldn't show them)
    - Show only financial documents (server-enforced via AD5)
    - All visible — read-only passive consumption

- [x] Task 8: Create tests (AC: all)
  - [x] 8.1 Service tests in `src/server/services/documents.test.ts` — add:
    - `getDocuments` — happy path with default sort/pagination, filtered by status, filtered by date range, search by businessKey, search by fileName, accountant role forces financial-only filter, empty result set, pagination (page 2 returns correct offset), sort by each field
    - `getDocumentFilterOptions` — returns distinct values, accountant sees financial types only
    - `getDocumentStats` — returns correct aggregates, accountant only counts financial docs, unreviewed count correct
    - `getDocuments` accountant security: accountant CANNOT retrieve relationship docs even when explicitly filtered (override test)
  - [x] 8.2 Service tests in `src/server/services/table-preferences.test.ts`:
    - `getTablePreference` — returns null when none exists, returns preference when exists
    - `upsertTablePreference` — creates new, updates existing (upsert), different tableKeys don't conflict
  - [x] 8.3 Storage service test in `src/server/services/storage.test.ts`:
    - `generateSasUrl` with contentDisposition parameter
    - `generateDownloadUrl` — correct content-disposition header, filename sanitization
    - **Azurite integration test:** Generate SAS URL with contentDisposition against Azurite, HTTP GET and verify `Content-Disposition` response header (catches Azurite limitation early)
  - [x] 8.4 Component tests:
    - `src/components/shared/data-table.test.tsx` — columns render, sorting, pagination, empty state, loading skeleton, row click
    - `src/components/domain/document-library-client.test.tsx` — renders with data, download uses `<a>` not window.open, accountant mode, empty states (no data, accountant empty), summary bar renders stats
  - [x] 8.5 E2E test — `e2e/document-library.spec.ts`:
    - Golden path: navigate to `/documents` → verify summary bar shows stats → see uploaded documents → filter by status → verify filtered results → click summary bar stat (filter shortcut) → verify filter applied → download document → use `page.waitForEvent('download')` to verify filename matches original
    - Accountant path: login as accountant → verify no upload zone → verify only financial docs visible
    - Empty state: fresh tenant → verify empty state message with CTA

- [x] Task 9: Testing & verification (AC: all)
  - [x] 9.1 Run full test suite: `npm run test` — baseline 502+, target 540+
  - [x] 9.2 Run lint: `npx biome check --write`
  - [x] 9.3 Run typecheck: `npm run typecheck` — passes clean after code review fixes
  - [x] 9.4 Verify build: `npm run build` — compiled successfully (Windows EINVAL on standalone copy is a pre-existing infra issue, not a code error)
  - [x] 9.5 Manual smoke test:
    - Navigate to `/documents` → verify DataTable renders with existing documents
    - Sort by business key → verify order changes
    - Filter by status "extracted" → verify only extracted docs shown
    - Filter by date range → verify period filtering works
    - Search by business key → verify results narrow
    - Click download → verify file downloads with correct name
    - Clear all filters → verify full list restored
    - Navigate away and back → verify Zustand filter persistence
    - Log out, log in → verify server-side filter preference restored
    - Test as accountant → verify financial-only, no upload zone, read-only

- [x] Task 10: Documentation (AC: #10)
  - [x] 10.1 Create `docs/document-library.md` documenting:
    - DataTable component usage and column definition pattern
    - Document library filters and server-side query pattern
    - Filter persistence (Zustand + server-side table preferences)
    - Download flow (SAS URL with content-disposition)
    - Role-based document access enforcement
    - Status badge color/icon mapping
    - Empty state patterns
  - [x] 10.2 Update `docs/index.md` with reference to `[[document-library]]`
  - [x] 10.3 Update `docs/document-review.md` with cross-link to library

## Dev Notes

### Existing Code to Reuse -- DO NOT Reinvent

| What | Where | Notes |
|------|-------|-------|
| Document service | `src/server/services/documents.ts` | `getRecentDocuments()`, `resolveDocumentData()` -- extend, don't replace |
| Document actions | `src/server/actions/documents.ts` | Add new actions here, don't create new file |
| Storage service | `src/server/services/storage.ts` | `generateSasUrl()` -- enhance with contentDisposition param |
| Action client | `src/server/middleware/action-client.ts` | `authedAction` for all new actions |
| Table primitives | `src/components/ui/table.tsx` | Use `<Table>`, `<TableHeader>`, `<TableBody>`, `<TableRow>`, `<TableHead>`, `<TableCell>` inside DataTable |
| Tenant store factory | `src/lib/stores/create-tenant-store.ts` | `createTenantStore<T>()` for document library Zustand store |
| Document review store | `src/hooks/use-document-review-store.ts` | Reference pattern for Zustand store structure |
| TanStack Table | `@tanstack/react-table` 8.21.3 | Already installed -- DO NOT add again |
| TanStack Virtual | `@tanstack/react-virtual` 3.13.21 | Already installed -- use for large lists |
| TanStack Query | `@tanstack/react-query` 5.90.21 | Already installed -- use for data fetching |
| Constants | `src/lib/constants.ts` | `SIGNED_URL_TTL_SECONDS = 300` |
| Audit logging | `src/server/services/audit.ts` | `toAuditData()` for change tracking |
| OCR types | `src/server/services/ocr.ts` | `OcrExtractedData` -- import for resolveDocumentData |
| Test fixtures | `src/server/db/test-fixtures.ts` | `createTestDocument(pool, tenantId, createdBy, overrides?)`, `cleanupTestData()` |
| Documents page | `src/app/(app)/documents/page.tsx` | Transform in-place -- keep FileUploadZone, replace table |
| Error page | `src/app/(app)/documents/error.tsx` | Already exists from Story 5.3 -- verify it covers library |
| File upload zone | `src/components/domain/file-upload-zone.tsx` | Keep at top of page, hide for accountant |
| UserPreference model | `prisma/schema/app.prisma` lines 213-222 | Reference pattern for non-tenant-scoped user data |
| Documents page status colors | `src/app/(app)/documents/page.tsx` | STATUS_COLORS map -- extract to shared constant or inline in DataTable column |

### DataTable Component Architecture

```
src/components/shared/data-table.tsx (generic, reusable)
  ├── Uses @tanstack/react-table for column defs, sorting state
  ├── Uses @tanstack/react-virtual (conditional, >50 rows)
  ├── Uses src/components/ui/table.tsx primitives
  ├── Props: columns, data, totalCount, page, sorting, callbacks
  └── Slots: emptyState, loadingState

src/components/domain/document-library-client.tsx (documents-specific)
  ├── Imports DataTable + DocumentStatsBar + DocumentLibraryFilters
  ├── Defines document columns (business key, type, status, date, vendor, amount, actions)
  │   └── Column meta: { compactHidden: true } on amount, fileSize for future density mode
  ├── Uses useDocumentLibraryStore (Zustand)
  ├── Uses useQuery (TanStack Query) for server fetching
  ├── Invalidates ['documents'] + ['document-stats'] on upload success
  └── Orchestrates: stats bar → filters → table → pagination
```

### Filter Persistence Flow

```
Page Mount:
  1. Server component calls getTablePreferenceAction("documents")
  2. Passes initial preferences to DocumentLibraryClient
  3. Client initializes Zustand store with server preferences (or defaults)
  4. First query fires with restored filters

Filter Change:
  1. User changes filter → Zustand store updates immediately
  2. TanStack Query refetches with new filters (stale-while-revalidate)
  3. After 2s debounce → upsertTablePreferenceAction("documents", { filters, sort })
  4. Server stores preference for next session

Navigation Away + Back (same session):
  1. Zustand store persists (createTenantStore keeps state in memory)
  2. No server call needed — instant filter restore

New Session Login:
  1. Server component loads preference from DB
  2. Client initializes from server data
  3. Seamless cross-session continuity
```

### Download Flow

```
User clicks download icon on document row:
  1. Client calls getDocumentDownloadUrlAction({ documentId })
  2. Server:
     a. Verify role access (accountant: financial only)
     b. Load document record (blobUrl, fileName)
     c. Call generateDownloadUrl(blobUrl, fileName, 5)
     d. Return { downloadUrl }
  3. Client: create invisible <a download> element, set href=downloadUrl, click(), remove()
  4. Browser downloads file with original filename via Content-Disposition header
  NOTE: If Azurite doesn't support contentDisposition in SAS (verified in Task 3.3),
        use proxy route /api/documents/[id]/download instead of SAS URL
```

### Role-Based Document Access (Enforced at Both Layers)

| Role | Server Filter | UI Visibility | Upload | Download | Edit/Delete |
|------|--------------|---------------|--------|----------|-------------|
| Owner | All documents | All columns + actions | Yes | Yes | Yes |
| Accountant | `documentType IN ('expense', 'invoice')` | Financial only, no upload zone | No | Yes (financial) | No |

### Status Badge Rendering

```
┌──────────────┬───────────────────────────┬─────────┐
│ Status       │ Badge                     │ Color   │
├──────────────┼───────────────────────────┼─────────┤
│ uploaded     │ ○ Uploaded                │ Gray    │
│ processing   │ ◌ Processing              │ Yellow  │
│ extracted    │ ○ Extracted               │ Gray    │
│ ocr_failed   │ ✕ OCR Failed              │ Red     │
│ linked       │ ✓ Linked                  │ Green   │
├──────────────┼───────────────────────────┼─────────┤
│ Needs Review │ ◑ Needs Review            │ Yellow  │
│ Reviewed     │ ✓ Reviewed                │ Green   │
└──────────────┴───────────────────────────┴─────────┘

Review sub-badge logic:
  - Show only when status is 'extracted' or 'ocr_failed'
  - reviewedAt IS NULL → "Needs Review" (yellow)
  - reviewedAt IS NOT NULL → "Reviewed" (green)
```

### Document Stats Summary Bar (AD7)

```
┌─────────────────────────────────────────────────────────────────────┐
│  📄 47 documents  │  ◑ 12 need review  │  ✕ 3 OCR failed  │  ...  │
└─────────────────────────────────────────────────────────────────────┘
  [each chip is clickable — applies filter to table below]
  - "47 documents" → clears all filters (shows everything)
  - "12 need review" → status=extracted + unreviewed
  - "3 OCR failed" → status=ocr_failed
  - Fetched via separate useQuery with staleTime: 30s
  - Invalidated on upload success (alongside documents query)
```

### Document Library Table Columns

```
┌──────────────────┬──────────┬────────────┬────────────┬──────────────┬───────────┬──────────┐
│ Business Key     │ Type     │ Status     │ Date       │ Vendor       │ Amount    │ Actions  │
├──────────────────┼──────────┼────────────┼────────────┼──────────────┼───────────┼──────────┤
│ inv_20260315_001 │ Invoice  │ ✓ Linked   │ 2026-03-15 │ Lufthansa    │ 12 500 SEK│ ⬇ 👁    │
│ exp_20260314_002 │ Expense  │ ◑ Needs R. │ 2026-03-14 │ Amazon       │ 450 SEK   │ ⬇ 👁    │
│ con_20260310_001 │ Contract │ ○ Uploaded │ 2026-03-10 │ Client AB    │ —         │ ⬇ 👁    │
└──────────────────┴──────────┴────────────┴────────────┴──────────────┴───────────┴──────────┘
                                                                          ⬇ = Download
                                                                          👁 = View/Review
```

- Business Key column: clickable link to `/documents/{id}`
- Amount: show `extractedAmount` + `extractedCurrency` from resolved data. Dash for relationship docs.
- Vendor: from resolved `vendorName` or `merchantName`. Dash if empty.
- Date: from resolved `invoiceDate` or `transactionDate`, fallback to `createdAt`
- Actions: download icon always visible, review/view icon links to detail page

### Pagination Controls

```
┌─────────────────────────────────────────────────────────────┐
│ Showing 1-25 of 47 documents    ◀ Prev  Page 1 of 2  Next ▶│
│                                 Page size: [25 ▼]           │
└─────────────────────────────────────────────────────────────┘
```

### Empty States

```
No documents at all:
┌─────────────────────────────────────────────┐
│        📄                                    │
│   No documents uploaded yet.                │
│   Drop files above to get started.          │
│                                              │
│   [Upload your first document]               │
└─────────────────────────────────────────────┘

No filter matches:
┌─────────────────────────────────────────────┐
│        🔍                                    │
│   No documents match your filters.          │
│                                              │
│   [Clear all filters]                        │
└─────────────────────────────────────────────┘

Accountant — no financial docs:
┌──────────────────────────────────────────────────────────────────┐
│        📄                                                        │
│   No financial documents have been uploaded for this period yet. │
│   The business owner will upload documents as they arrive.       │
└──────────────────────────────────────────────────────────────────┘
```

### Previous Story Intelligence (Story 5.3)

**Key learnings from Story 5.3:**
- `resolveDocumentData(extractedData, corrections)` is exported from documents service — reuse for computing vendor/amount in table rows
- Status colors map already exists in `documents/page.tsx` — extract to shared location or keep inline
- Test baseline: 502 tests (9 pre-existing failures in settings.test.ts — unrelated)
- Always run `npx biome check --write` before commit
- `createTestDocument(pool, tenantId, createdBy, overrides?)` fixture available for tests
- Component tests mock server actions via `vi.mock("@/server/actions/documents")`
- E2E auth setup: sign in → set active org → navigate (per CI/CD lessons)

**Recent Git Activity:**
- `fix/ocr-transaction-timeout` branch merged — moved OCR call outside RLS transaction
- Blob proxy added for local dev document preview (`src/app/api/blob-proxy/route.ts`)
- Azurite CORS configured for local dev

### Git Commit Sequence

1. Task 0 (Prisma migration) — add table_preferences
2. Task 1 (table preference service + actions)
3. Task 2 (document service — getDocuments, getDocumentFilterOptions)
4. Task 3 (storage service — download URL enhancement)
5. Task 4 (document library server actions)
6. Task 5 (DataTable shared component)
7. Task 6 (filter components + Zustand store)
8. Task 7 (document library page transformation)
9. Task 8 (tests — services + components + E2E)
10. Task 9 (verification — all green)
11. Task 10 (docs)

Run `npx biome check --write` before EVERY commit.

### Architecture Compliance

- `src/server/services/documents.ts` MUST NOT import from `next/*` or `src/components/*`
- `src/server/services/table-preferences.ts` MUST NOT import from `next/*` or `src/components/*`
- `src/components/shared/data-table.tsx` MUST NOT import from `@/server/*` (except type imports)
- `src/components/domain/document-library-client.tsx` MUST NOT import from `@/server/*` (except type imports from actions)
- Server Actions in `src/server/actions/documents.ts` are thin wrappers -- logic in services
- Server Actions never throw -- return `{ error: AppError }` objects
- Sidebar hides UI by role, Server Actions enforce RBAC server-side. Both required.
- Money stays as Decimal until component display boundary
- All DB timestamps use TIMESTAMPTZ

### Project Structure Notes

**New files to create:**
```
prisma/migrations/YYYYMMDD_add_table_preferences/migration.sql
src/server/services/table-preferences.ts
src/server/services/table-preferences.test.ts
src/server/actions/table-preferences.ts
src/components/shared/data-table.tsx
src/components/shared/data-table.test.tsx
src/components/domain/document-library-client.tsx
src/components/domain/document-library-client.test.tsx
src/components/domain/document-library-filters.tsx
src/components/domain/document-stats-bar.tsx
src/hooks/use-document-library-store.ts
e2e/document-library.spec.ts
docs/document-library.md
```

**Files to modify:**
```
prisma/schema/app.prisma                    — new TablePreference model
src/server/services/documents.ts            — getDocuments, getDocumentFilterOptions, getDocumentStats
src/server/services/documents.test.ts       — ~12 new tests for library queries
src/server/services/storage.ts              — enhance generateSasUrl with contentDisposition
src/server/services/storage.test.ts         — download URL tests
src/server/actions/documents.ts             — getDocumentsAction, getDocumentFilterOptionsAction, getDocumentDownloadUrlAction
src/app/(app)/documents/page.tsx            — transform to library page with DataTable
docs/index.md                               — [[document-library]] reference
docs/document-review.md                     — cross-link to library
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md -- Epic 5, Story 5.4]
- [Source: _bmad-output/planning-artifacts/architecture.md -- Hexagonal Architecture, Server Action Pattern, Blob Storage, RLS, CallerIdentity]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md -- ServerDataTable, FilterEngine, Filter Persistence, Empty States, Status Badges, Role-Based UI]
- [Source: _bmad-output/planning-artifacts/prd.md -- FR8 (download), FR33-34 (accountant access), Role x Document-Type Matrix]
- [Source: _bmad-output/implementation-artifacts/5-3-document-review-correction.md -- Previous story learnings, resolveDocumentData, test patterns]
- [Source: src/server/services/documents.ts -- Existing service methods, getRecentDocuments, resolveDocumentData]
- [Source: src/server/services/storage.ts -- generateSasUrl pattern, downloadBlob, uploadBlob with contentDisposition]
- [Source: src/server/actions/documents.ts -- Existing action patterns]
- [Source: src/components/ui/table.tsx -- Table primitives for DataTable component]
- [Source: src/lib/stores/create-tenant-store.ts -- Zustand tenant-aware store factory]
- [Source: src/hooks/use-document-review-store.ts -- Reference Zustand store pattern]
- [Source: prisma/schema/app.prisma -- Document model, UserPreference model pattern]
- [Source: package.json -- @tanstack/react-table 8.21.3, @tanstack/react-virtual 3.13.21, @tanstack/react-query 5.90.21]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Azurite contentDisposition SAS support: validated early via Node.js script — Azurite DOES support it. No proxy route needed.
- `prisma migrate dev` is non-interactive in this environment: created migration SQL manually and ran `prisma migrate deploy`.
- DataTable tests: replaced `toBeInTheDocument()` (jest-dom) with `.toBeDefined()` to match existing codebase pattern. Added `cleanup()` after each test to prevent DOM state sharing. Used `getByRole` with accessible names to avoid multi-match errors.
- next-safe-action wrapping: actions return `result.data = { data: T }`, so client accesses actual data at `result?.data?.data`.
- `createAuthenticatedContext` only accepts `"owner" | "member"`: accountant tests use `"member"` — the fixture maps to accountant CallerIdentity via org membership.

### Completion Notes List

- Azurite integration tests skip when `AZURE_STORAGE_CONNECTION_STRING` is not set (matches existing storage.test.ts pattern).
- Date filter (`dateFrom`/`dateTo`) filters on `createdAt` (upload date), not `extractedDate` (invoice/transaction date). The "Date" column shows `extractedDate` when available, creating a semantic mismatch. Fixing properly requires an indexed `extractedDate` column — deferred to a future story.

### Code Review Fixes Applied (2026-03-16)

- **H1**: Moved `getDocumentDownloadUrl` business logic (role check, DB query, URL generation) from action to service — action is now a thin wrapper per hexagonal arch
- **H2**: Fixed DataTable virtualization — replaced broken `translateY` approach with padding-row approach that maintains valid HTML table structure
- **H3**: Amount column `accessorKey: "fileSize"` removed — column was sorting by file size while labelled "Amount"; sorting disabled on Amount column
- **M3**: Fixed preference persistence never firing for new users — `prefInitialized.current` now always set to `true` after first mount regardless of whether stored preferences exist
- **L1**: Removed dead `useRef` block for `upsertTablePreferenceAction` (both branches returned null, dynamic import used instead)
- **L2**: `table-preferences` service now uses `PrismaClient` directly per AD3 (user-scoped, not tenant-scoped); action and page.tsx updated accordingly
- **C1**: Committed pre-existing fix in `documents.test.ts` — 3 accountant tests used invalid `"accountant"` role in `createAuthenticatedContext` (only accepts `"owner" | "member"`)
- **C2/L3**: Created `document-library-client.test.tsx` with component tests for download pattern, empty states, accountant mode, and stats bar
- **M1**: Typecheck and build verified — both pass clean

### File List

**New files:**
- `prisma/migrations/20260315000000_add_table_preferences/migration.sql`
- `src/server/services/table-preferences.ts`
- `src/server/services/table-preferences.test.ts`
- `src/server/actions/table-preferences.ts`
- `src/components/shared/data-table.tsx`
- `src/components/shared/data-table.test.tsx`
- `src/components/domain/document-library-client.tsx`
- `src/components/domain/document-library-client.test.tsx`
- `src/components/domain/document-library-filters.tsx`
- `src/components/domain/document-stats-bar.tsx`
- `src/components/domain/document-upload-zone.tsx`
- `src/hooks/use-document-library-store.ts`
- `e2e/document-library.spec.ts`
- `docs/document-library.md`

**Modified files:**
- `prisma/schema/app.prisma` — added TablePreference model
- `src/server/services/documents.ts` — added getDocuments, getDocumentFilterOptions, getDocumentStats
- `src/server/services/documents.test.ts` — added tests for new service methods
- `src/server/services/storage.ts` — enhanced generateSasUrl with contentDisposition, added generateDownloadUrl
- `src/server/services/storage.test.ts` — added download URL + Content-Disposition tests
- `src/server/actions/documents.ts` — added getDocumentsAction, getDocumentFilterOptionsAction, getDocumentStatsAction, getDocumentDownloadUrlAction
- `src/app/(app)/documents/page.tsx` — transformed to library page with DataTable
- `e2e/documents.spec.ts` — updated accountant test (no longer redirects)
- `docs/index.md` — added [[document-library]] entry
- `docs/document-review.md` — added cross-link to [[document-library]]
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status update
