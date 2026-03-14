# Blob Storage

Azure Blob Storage integration using `@azure/storage-blob` SDK with Azurite for local development.

## Architecture

- **Single container** named `documents` (from `AZURE_STORAGE_CONTAINER` env var)
- **Path structure:** `{tenantId}/{uuid}.{ext}` — tenant isolation at path level
- **Service location:** `src/server/services/storage.ts` — framework-agnostic (hexagonal boundary)
- **Callers provide `blobPath`** — the service has no knowledge of tenants

## Azurite Setup

Azurite runs as a Docker container (defined in `docker-compose.yml`):

```bash
docker compose up azurite -d
```

Ports: 10000 (blob), 10001 (queue), 10002 (table)

The `--skipApiVersionCheck` flag is set in docker-compose.yml because the latest `@azure/storage-blob` SDK may use API versions newer than what the current Azurite image supports.

## Connection String

Local/Azurite default (in `.env.example` and `.env.local`):

```
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;...
AZURE_STORAGE_CONTAINER=documents
```

Production uses a real Azure Storage connection string.

## SDK Usage

```typescript
import { createStorageService } from "@/server/services/storage";

const storage = createStorageService();
await storage.ensureContainer();

// Upload
const url = await storage.uploadBlob(`${tenantId}/${uuid}.pdf`, buffer, "application/pdf");

// Download
const data = await storage.downloadBlob(`${tenantId}/${uuid}.pdf`);

// Generate SAS URL (5-minute TTL)
const sasUrl = await storage.generateSasUrl(`${tenantId}/${uuid}.pdf`, 5);

// Delete
await storage.deleteBlob(`${tenantId}/${uuid}.pdf`);
```

## Test Patterns

Integration tests run against Azurite and are guarded with:

```typescript
describe.skipIf(!process.env.AZURE_STORAGE_CONNECTION_STRING)("StorageService (Azurite)", () => {
  // ...
});
```

**Test isolation:** Each test run creates a unique container (`test-${Date.now()}`), cleaned up in `afterAll`.

**CI strategy:** CI does NOT run Azurite. Storage tests are automatically skipped when `AZURE_STORAGE_CONNECTION_STRING` is not set. Locally, `docker compose up azurite -d` must be running.

To run storage tests locally:

```bash
docker compose up azurite -d
npm run test -- src/server/services/storage.test.ts
```

If AZURE_STORAGE_CONNECTION_STRING is not loaded from .env.local by vitest, pass it explicitly:

```bash
AZURE_STORAGE_CONNECTION_STRING="..." npm run test -- src/server/services/storage.test.ts
```

## Known Limitations

- **SAS URL hostnames:** Azurite SAS URLs use `127.0.0.1:10000`, production uses the Azure Blob endpoint. The SDK handles this — do not hardcode hostnames.
- **API version mismatch:** The latest `@azure/storage-blob` SDK may use API versions not yet supported by Azurite. Use `--skipApiVersionCheck` flag on Azurite (already configured in docker-compose.yml).
