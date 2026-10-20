# Document-Type Prefixes

Configurable prefixes for business key generation on document uploads.

## Overview

Each tenant can define custom prefixes for different document types. When documents are uploaded (Epic 5), the system generates a business key using these prefixes.

**Business key pattern:** `[prefix][date]_[BAS-short]_[Partner]_[sequence].ext`

Example: `exp_20260313_Tr_Lufthansa_001.pdf`

## Default Prefixes

On first access, the system auto-seeds these defaults:

| Document Type | Prefix  | Example Key                    |
|---------------|---------|--------------------------------|
| expense       | `exp_`  | `exp_20260313_Tr_Acme_001.pdf` |
| invoice       | `inv_`  | `inv_20260313_Fö_Client_001.pdf` |
| contract      | `ctrt_` | `ctrt_20260313_001.pdf`        |
| nda           | `nda_`  | `nda_20260313_001.pdf`         |
| certificate   | `cert_` | `cert_20260313_001.pdf`        |

## Seed-on-First-Access Pattern

Defaults are NOT seeded on tenant creation. Instead:

1. First time the owner visits Document Prefixes settings, the action checks `prefixes_seeded` flag in [[tenant-management|TenantConfig]]
2. If not seeded → calls `seedDocumentTypePrefixes()` → inserts defaults + sets flag
3. If already seeded → returns existing prefixes (even if empty after deliberate deletion)

This prevents the **delete-all-then-reseed bug**: if the owner deletes all prefixes, they stay deleted on next visit.

## Validation Rules

- **Prefix:** Lowercase alphanumeric + trailing underscore. Regex: `/^[a-z0-9]+_$/`. Max 10 characters. Input is auto-lowercased
- **Document type:** Lowercase alphanumeric + hyphens. Max 30 characters. Free-form (no enum)

## Architecture

- **Model:** `DocumentTypePrefix` in `app.prisma` — tenant-scoped with RLS
- **Service:** `src/modules/documents/document-type-prefixes.ts` — CRUD + seed
- **Actions:** `src/modules/documents/document-type-prefixes.actions.ts` — `ownerAction` for all operations
- **UI:** `src/modules/documents/components/document-type-prefixes-tab.tsx` — card-based list with inline edit

## Downstream Consumers

- **Epic 5 (Document Management):** Story 5.1 uses `getDocumentTypePrefixes()` for business key generation
- **Epic 6 (Banking):** Journal entry business keys are separate but follow similar patterns
- **Epic 10 (Invoicing):** Invoice numbering may reference the `inv_` prefix

## Related

- [[bank-accounts]] — Similar CRUD pattern for tenant configuration
- [[vat-registrations]] — Similar settings tab pattern
- [[user-preferences]] — User-scoped preferences (different from tenant-scoped prefixes)
