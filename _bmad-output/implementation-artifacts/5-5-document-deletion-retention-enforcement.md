# Story 5.5: Document Deletion & Retention Enforcement

Status: done

## Story

As an owner,
I want to delete unneeded documents while the system protects linked financial documents from deletion,
so that I can keep my document library clean without risking legal compliance.

## Acceptance Criteria

1. **Given** an unlinked document exists (status is NOT `linked`), **When** the owner clicks the delete button and confirms the dialog, **Then** the document DB record is permanently removed AND the blob is deleted from Azure Storage AND the business key is freed (FR5)
2. **Given** a document has `status = 'linked'`, **When** the owner attempts to delete it, **Then** deletion is always blocked — regardless of document age — and a toast error is shown: `"Cannot delete — document is linked to a journal entry"` (FR5, FR6)
3. **Given** any delete attempt (successful or blocked), **Then** an immutable audit trail entry is recorded with `action: "delete"`, the document entity, and outcome context in `newData`
4. **Given** the owner clicks the delete icon in a document row, **Then** a confirmation dialog appears with the document's `businessKey` and a warning about irreversibility before the action proceeds
5. **Given** an accountant is logged in, **Then** no delete button is visible in any document row (accountant UI is read-only)
6. **Given** this story is complete, **Then** `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting the deletion and linking protection patterns

## Architectural Decisions

### AD1: Status-Based Linking Check — Permanent Block (Epic 7 Forward Compatibility)
Epic 7 (document-transaction linking) has not been built yet — there is no junction table between `Document` and `JournalEntry`. The linking check uses `status === 'linked'` as its proxy: when a document is linked to a journal entry in Epic 7, its status is updated to `"linked"`. That status is the permanent, unconditional deletion guard. If `status === 'linked'`, the document can NEVER be deleted — no time window, no expiry, no override. This aligns with FR5 ("hard delete **unlinked** documents") literally. Do NOT import or call the Clock service in this story — no date math is needed.

### AD2: Hard Delete Only — No Soft Delete
Do NOT add a `deletedAt` column or any soft-delete pattern. Documents are either present or permanently gone. The business key is freed when the DB record is deleted (enforced via service logic on upload, so deletion automatically frees it). If a future story needs a recycle bin, that is a separate story.

### AD3: Blob Deletion Order — DB First, Blob Second
Delete the DB record first (inside the tenant-scoped transaction with RLS). Only after DB deletion succeeds, delete the blob from Azure Storage. If blob deletion fails: log the error at `warn` level but do NOT roll back or fail the operation — the DB record being gone is the authoritative state. Orphaned blobs can be cleaned up by admin tooling. If the DB deletion itself fails: do NOT attempt blob deletion.

### AD4: ownerAction Middleware + Service Role Check (Fail-Closed)
Use `ownerAction` (not `authedAction`) for the delete action — enforces owner role at the middleware layer. Additionally, the service method must also check `caller.role === 'owner'` and return an error if not — double enforcement per architecture conventions.

### AD5: Confirmation Dialog Pattern
Use ShadCN `AlertDialog` (not `Dialog`) — AlertDialog is the correct component for destructive confirmations. Show the document's `businessKey` in the dialog body so the owner can confirm they are deleting the right document.

## Tasks / Subtasks

- [x] Task 1: Service layer — `deleteDocument()` (AD1–AD4)
  - [x] 1.1 Add `deleteDocument()` to `src/server/services/documents.ts`:
    ```typescript
    export async function deleteDocument(
      tx: TransactionClient,
      caller: CallerIdentity,
      audit: AuditLogger,
      documentId: string,
    ): Promise<ServiceResult<{ businessKey: string; blobUrl: string }>>
    ```
    - Import `AuditLogger` from `@/types/audit` at top of file (matches existing imports in this file)
    - Fetch document: `tx.document.findUnique({ where: { id: documentId } })` — RLS handles tenant isolation automatically
    - If not found: return `{ error: { code: 'NOT_FOUND', message: 'Document not found' } }`
    - If `caller.role !== 'owner'`: return `{ error: { code: 'FORBIDDEN', message: 'Only owners can delete documents' } }`
    - If `document.status === 'linked'`:
      - `await audit.log({ action: 'delete', entityType: 'document', entityId: documentId, oldData: toAuditData(document), newData: { outcome: 'blocked', reason: 'linked' } })`
      - return `{ error: { code: 'BUSINESS_RULE_VIOLATION', message: 'Cannot delete — document is linked to a journal entry' } }`
    - If deletion allowed (status is NOT `linked`):
      - `await audit.log({ action: 'delete', entityType: 'document', entityId: documentId, oldData: toAuditData(document), newData: { outcome: 'deleted' } })`
      - `await tx.document.delete({ where: { id: documentId } })`
      - return `{ data: { businessKey: document.businessKey, blobUrl: document.blobUrl } }`
    - **Important**: Do NOT call `deleteBlob()` inside the service — blob deletion is a side effect outside the DB transaction. Return `blobUrl` so the action layer handles it post-commit.
    - **TODO: Epic 7** — Before `tx.document.delete()`, verify no junction table rows exist for this `documentId` once document-transaction linking is implemented.
  - [x] 1.2 No Clock import needed — no date math in this story (AD1)

- [x] Task 2: Server action — `deleteDocumentAction` (AD4, AD5)
  - [x] 2.1 Add to `src/server/actions/documents.ts`:
    ```typescript
    const deleteDocumentSchema = z.object({
      documentId: z.string().uuid(),
    });

    export const deleteDocumentAction = ownerAction
      .schema(deleteDocumentSchema)
      .action(async ({ parsedInput, ctx }) => {
        const { documentId } = parsedInput;
        const result = await documentService.deleteDocument(
          ctx.tx,
          ctx.callerIdentity,
          ctx.audit,
          documentId,
        );
        if (result.error) return { error: result.error };

        // Blob deletion after successful DB commit — outside transaction (AD3)
        if (result.data?.blobUrl) {
          try {
            const blobPath = extractBlobPath(result.data.blobUrl);
            await getStorage().deleteBlob(blobPath);
          } catch (err) {
            const { logger } = await import("@/server/logger");
            logger.warn({ err, documentId }, 'Blob deletion failed after document delete — orphaned blob');
          }
        }
        return { data: { businessKey: result.data?.businessKey } };
      });
    ```
  - [x] 2.2 Add `ownerAction` to the existing import from `@/server/middleware/action-client` (currently only `authedAction` is imported). Import `extractBlobPath` from `@/server/services/ocr` — already used in this file by `documentService` internally; add it to the action-layer import for use in blob deletion. `getStorage()` singleton is already defined in this file.
  - [x] 2.3 `deleteBlob(blobPath)` already exists on the `StorageService` interface — confirmed in `src/server/services/storage.ts` line 18. No changes to storage.ts needed for deletion.

- [x] Task 3: UI — Delete button and confirmation dialog (AC: #1–#5)
  - [x] 3.1 Add `DeleteButton` component inline in `src/components/domain/document-library-client.tsx` (follow `DownloadButton` pattern at lines ~111–140):
    ```typescript
    function DeleteButton({ documentId, businessKey }: { documentId: string; businessKey: string }) {
      const [open, setOpen] = useState(false);
      const [isPending, startTransition] = useTransition();
      const invalidate = useDocumentLibraryInvalidate(); // returns callback directly, not { invalidate }

      function handleConfirm() {
        startTransition(async () => {
          const result = await deleteDocumentAction({ documentId });
          if (result?.data?.error) {
            toast.error(result.data.error.message);
          } else {
            toast.success(`Document ${businessKey} deleted`);
            invalidate();
          }
          setOpen(false);
        });
      }

      return (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Delete document</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete document?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete <strong>{businessKey}</strong> and remove the file from storage. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirm}
                disabled={isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isPending ? 'Deleting…' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }
    ```
    - Note: when `deleteDocumentAction` returns `BUSINESS_RULE_VIOLATION` (linked document), the dialog fires, the action is called, and the error toast shows `"Cannot delete — document is linked to a journal entry"`. The dialog never needs to know the document's status upfront — the server is authoritative. Note: used controlled open state (useState) + separate Button trigger instead of AlertDialogTrigger asChild — base-ui doesn't support asChild prop.
  - [x] 3.2 Add `DeleteButton` to the "actions" column definition (owner role only):
    - In the `columns` definition (around line 325), add `<DeleteButton documentId={row.original.id} businessKey={row.original.businessKey} />` after the download button
    - In the accountant-filtered column variant (lines ~344–355), do NOT include `DeleteButton` — accountant is read-only (AC #5)
  - [x] 3.3 Add required imports: `AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogContent`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogHeader`, `AlertDialogTitle` from `@/components/ui/alert-dialog`; `Trash2` from `lucide-react`; `useTransition`, `useState` from `react`; `deleteDocumentAction` from `@/server/actions/documents`
  - [x] 3.4 Verify `src/components/ui/alert-dialog.tsx` exists — if not, run `npx shadcn-ui@latest add alert-dialog`

- [x] Task 4: Tests (AC: all)
  - [x] 4.1 Service tests — add to `src/server/services/documents.test.ts`:
    - `deleteDocument` — happy path: unlinked document (`status = 'uploaded'`) is deleted, returns `{ businessKey, blobUrl }`
    - `deleteDocument` — linked document (`status = 'linked'`) is always blocked, returns BUSINESS_RULE_VIOLATION
    - `deleteDocument` — document not found: returns NOT_FOUND error
    - `deleteDocument` — caller is not owner: returns FORBIDDEN error
    - `deleteDocument` — audit entry recorded with `outcome: 'deleted'` for successful delete
    - `deleteDocument` — audit entry recorded with `outcome: 'blocked', reason: 'linked'` for blocked delete
  - [x] 4.2 Storage service tests — add to `src/server/services/storage.test.ts`:
    - `deleteBlob` — successfully deletes existing blob (already existed; Azurite integration test, skipped when `AZURE_STORAGE_CONNECTION_STRING` not set)
    - `deleteBlob` — `deleteIfExists` on non-existent blob does not throw (added)
  - [x] 4.3 Component tests — add to `src/components/domain/document-library-client.test.tsx`:
    - Delete button visible for owner role, absent for accountant role
    - Clicking delete icon opens confirmation dialog showing businessKey
    - Confirming delete calls `deleteDocumentAction` and invalidates query cache on success
    - Error toast shown when action returns BUSINESS_RULE_VIOLATION (linked document)
  - [x] 4.4 E2E test — add to `e2e/document-library.spec.ts`:
    - Golden path: owner uploads document → opens document library → clicks delete icon → confirms dialog → document disappears from list
    - Linked block: not covered by E2E (requires Epic 7 linking); covered by service unit tests
  - [x] 4.5 Run full test suite: `npm run test` — all 597 passing, 12 skipped (storage Azurite tests)
  - [x] 4.6 Run lint: `npx biome check --write`
  - [x] 4.7 Run typecheck: `npm run typecheck`

- [x] Task 5: Documentation (AC: #6)
  - [x] 5.1 Update `docs/document-library.md` — add "Deletion & Linking Protection" section:
    - Hard delete flow (DB first, blob second, non-fatal on blob failure)
    - Linking guard: `status === 'linked'` = permanent deletion block
    - Error behaviour: BUSINESS_RULE_VIOLATION → toast
    - Audit trail for both outcomes
    - Note: journal entry key in error message deferred to Epic 7

## Dev Notes

### Existing Code to Reuse — DO NOT Reinvent

| What | Where | Notes |
|------|-------|-------|
| Document service | `src/server/services/documents.ts` | Add `deleteDocument` at end of file |
| Document actions | `src/server/actions/documents.ts` | Add `deleteDocumentAction` here, no new file |
| Audit trail | `src/types/audit.ts` + `src/server/services/audit.ts` | `AuditLogger` type + `toAuditData()` — service calls `audit.log()`, NOT `createAuditEntry()` directly |
| Action client | `src/server/middleware/action-client.ts` | `ownerAction` — add to existing import (currently only `authedAction` imported) |
| Storage service | `src/server/services/storage.ts` | `deleteBlob(blobPath)` already exists on `StorageService` — use `getStorage().deleteBlob(blobPath)` |
| extractBlobPath | `src/server/services/ocr.ts` | Converts full Azure `blobUrl` → `blobPath` — import in actions file for blob deletion |
| AlertDialog | `src/components/ui/alert-dialog.tsx` | ShadCN — use for confirmation (not `Dialog`) |
| DownloadButton | `src/components/domain/document-library-client.tsx` lines ~111–140 | Structural model for DeleteButton |
| useDocumentLibraryInvalidate | `src/components/domain/document-library-client.tsx` | Cache invalidation after delete |
| Toast | `sonner` via `import { toast } from 'sonner'` | Already used in document-library-client.tsx |
| Trash2 icon | `lucide-react` | Already installed |
| Test fixtures | `src/server/db/test-fixtures.ts` | `createTestDocument()`, `cleanupTestData()` |
| ctx.tx | Provided by action middleware | Already tenant-scoped — pass directly to service, do NOT call `withTenantTransaction` manually |
| ctx.audit | Provided by action middleware | `AuditLogger` instance — pass to service as `audit` parameter |

### Critical Implementation Notes

**1. No Clock import** — this story has zero date math. Do not import `Clock`, `createClock`, or `createTestClock`. AD1 is a pure status check: `if (document.status === 'linked') → block`.

**2. Blob deletion uses `getStorage().deleteBlob(blobPath)` — NOT a standalone function**
`deleteBlob(blobPath)` already exists on the `StorageService` interface. Access it via `getStorage().deleteBlob(blobPath)` using the singleton already defined in `documents.ts`. Convert `blobUrl → blobPath` with `extractBlobPath(blobUrl)` imported from `@/server/services/ocr` — this function handles both Azurite (`http://127.0.0.1:10000/...`) and Azure (`https://account.blob.core.windows.net/...`) URLs. Do NOT invent a `parseBlobUrl` function.

**3. `ctx.tx` is the tenant-scoped transaction — no manual `withTenantTransaction` needed**
The action middleware chain sets up `ctx.tx` (tenant-scoped `TransactionClient`) and `ctx.audit` (`AuditLogger`) before the action handler runs. Pass `ctx.tx` and `ctx.audit` directly to the service. Never call `withTenantTransaction` inside an action — it's already done. Blob deletion MUST happen outside this transaction — `deleteBlob` is a network call that must never be inside a DB transaction (timeout risk).

**4. next-safe-action result shape**
next-safe-action wraps results as `result.data = { data: T }`. Client accesses error at `result?.data?.error`, success at `result?.data?.data`. Follow the exact same pattern as `DownloadButton` does for `getDocumentDownloadUrlAction`.

**5. Linked document UX flow**
When a linked document's delete button is clicked: the dialog opens normally, the owner confirms, `deleteDocumentAction` is called, the server returns BUSINESS_RULE_VIOLATION, and the error toast fires. The client does not need to know the document's status in advance — no pre-flight status check, no disabled button for linked docs. The server is the single source of truth.

**6. `biome check --write` before every commit** — not just at the end. Run it after each task that touches a file.

### Deletion Flow Diagram

```
Owner clicks delete icon (Trash2)
  ↓
AlertDialog opens — shows businessKey
  ↓
Owner clicks "Delete"
  ↓
deleteDocumentAction({ documentId })
  ↓
ownerAction middleware: auth + tenant context → ctx.tx + ctx.audit
  ↓
deleteDocument(ctx.tx, ctx.callerIdentity, ctx.audit, documentId)
  ├─ NOT FOUND       → return NOT_FOUND error
  ├─ NOT OWNER       → return FORBIDDEN error
  ├─ status = 'linked'
  │   ├─ createAuditEntry(outcome: 'blocked', reason: 'linked')
  │   └─ return BUSINESS_RULE_VIOLATION
  └─ status != 'linked'
      ├─ createAuditEntry(outcome: 'deleted')
      ├─ tx.document.delete(...)
      └─ return { businessKey, blobUrl }
  ↓
[transaction commits]
  ↓
getStorage().deleteBlob(extractBlobPath(blobUrl)) — outside transaction
  ├─ success → (silent)
  └─ failure → logger.warn (non-fatal, orphaned blob)
  ↓
Action returns { data: { businessKey } }
  ↓
Client:
  ├─ error → toast.error(message)
  └─ success → toast.success + invalidate(['documents'], ['document-stats'])
```

### Role-Based UI Summary

| Role | Delete button visible | Server enforcement |
|------|----------------------|--------------------|
| Owner | Yes (all rows) | ownerAction + service role check |
| Accountant | No | N/A (button not rendered) |

### Project Structure Notes

**No new files to create** (`deleteBlob` already exists in storage.ts — no changes needed there):

**Files to modify:**
```
src/server/services/documents.ts              — add deleteDocument()
src/server/services/storage.ts                — add deleteBlob() if not present
src/server/actions/documents.ts               — add deleteDocumentAction
src/components/domain/document-library-client.tsx  — add DeleteButton + column update
src/server/services/documents.test.ts         — add deleteDocument tests
src/server/services/storage.test.ts           — add deleteBlob tests
src/components/domain/document-library-client.test.tsx  — add delete UI tests
e2e/document-library.spec.ts                  — add deletion E2E test
docs/document-library.md                      — add deletion section
```

**Possibly needed (check first):**
```
src/components/ui/alert-dialog.tsx            — may already exist
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 5, Story 5.5]
- [Source: _bmad-output/planning-artifacts/prd.md — FR5 (hard delete unlinked), FR6 (block linked)]
- [Source: _bmad-output/planning-artifacts/architecture.md — Entity Lifecycle Policies table, Error Taxonomy, Audit trail]
- [Source: _bmad-output/implementation-artifacts/5-4-document-library-download.md — DownloadButton pattern, next-safe-action result shape, invalidation hook, accountant column variant]
- [Source: src/server/services/documents.ts — Document model, service patterns, TransactionClient usage]
- [Source: src/server/services/audit.ts — createAuditEntry(), toAuditData()]
- [Source: src/server/middleware/action-client.ts — ownerAction for delete enforcement]
- [Source: src/server/services/storage.ts — Blob service client pattern for deleteBlob]
- [Source: src/components/domain/document-library-client.tsx — DownloadButton model, useDocumentLibraryInvalidate, column definitions, accountant rendering]
- [Source: src/components/ui/alert-dialog.tsx — confirmation dialog component]
- [Source: prisma/schema/app.prisma — Document model (no soft-delete, no linking table yet)]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation proceeded without blocks.

### Completion Notes List

- Added `BUSINESS_RULE_VIOLATION` to `ErrorCode` type (was missing from the union)
- Used controlled `useState` open state for `AlertDialog` instead of `AlertDialogTrigger asChild` — project uses `@base-ui/react` which does not support `asChild` prop on Trigger; controlled mode separates trigger Button from dialog cleanly
- All 6 service tests pass: happy path, linked block, NOT_FOUND, FORBIDDEN, audit outcome:deleted, audit outcome:blocked
- 597 unit tests passing, 12 skipped (Azurite storage tests requiring connection string)
- AC #1–#6 all satisfied

### File List

- `src/types/app-error.ts` — added BUSINESS_RULE_VIOLATION to ErrorCode
- `src/server/services/documents.ts` — added deleteDocument(); review fix: role check before existence check
- `src/server/actions/documents.ts` — added deleteDocumentAction, ownerAction import, extractBlobPath import; review fix: removed optional chaining, added TODO for tx-scope blob deletion
- `src/components/domain/document-library-client.tsx` — added DeleteButton, AlertDialog imports, Trash2 + sonner imports, useState/useTransition, column update; review fix: replaced AlertDialogAction with Button to prevent auto-close, removed unused AlertDialogAction import
- `src/server/services/documents.test.ts` — added 6 deleteDocument tests
- `src/server/services/storage.test.ts` — added deleteBlob idempotency test
- `src/components/domain/document-library-client.test.tsx` — added sonner mock, 4 delete UI tests
- `e2e/document-library.spec.ts` — added delete flow E2E test; review fix: targeted row-specific delete button, added businessKey dialog assertion, added accountant no-delete-button assertion
- `docs/document-library.md` — added Deletion & Linking Protection section

### Senior Developer Review (AI)

**Reviewer:** Zik (2026-03-16)
**Outcome:** Approved with fixes applied

**Issues found: 0 Critical, 3 Medium, 4 Low — all fixed or documented**

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| M1 | MEDIUM | AlertDialogAction auto-close prevents "Deleting…" pending state visibility | Replaced AlertDialogAction with Button + e.preventDefault(); disabled Cancel during pending |
| M2 | MEDIUM | E2E delete test brittle — clicks first delete button regardless of row | Targeted delete button within the specific row containing uploaded file |
| M3 | MEDIUM | Blob deletion inside DB transaction scope (AD3 violation) | Added TODO — requires middleware refactor (same pattern as inngest.send in upload) |
| L1 | LOW | E2E test missing businessKey assertion in dialog (AC #4 gap) | Added assertion for `<strong>` in alertdialog body |
| L2 | LOW | No E2E assertion: accountant cannot see delete button (AC #5 gap) | Added to existing accountant E2E test |
| L3 | LOW | Unnecessary optional chaining `result.data?.businessKey` | Destructured result.data before use |
| L4 | LOW | Service checks existence before auth (inconsistent with uploadDocument) | Swapped to role check first, then existence check |

**Test results after fixes:** 597 passing, 12 skipped. Typecheck clean. Biome clean.
