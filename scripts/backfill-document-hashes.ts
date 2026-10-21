// One-off: hash the documents stored before `content_hash` existed (specs/documents US2) by reading each blob once.
//   DATABASE_URL=postgresql://… AZURE_STORAGE_CONNECTION_STRING=… npx tsx scripts/backfill-document-hashes.ts
// Idempotent: rows that already carry a hash are skipped; a blob that cannot be read is reported and left null.
import { prisma } from "@/kernel/db/client";
import { extractBlobPath } from "@/kernel/ocr/ocr";
import { createStorageService } from "@/kernel/storage/storage";
import { contentHashOf } from "@/modules/documents";

async function main() {
  const storage = createStorageService();
  const rows = await prisma.document.findMany({
    where: { contentHash: null },
    select: { id: true, businessKey: true, blobUrl: true },
  });
  let done = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const bytes = await storage.downloadBlob(extractBlobPath(row.blobUrl));
      await prisma.document.update({
        where: { id: row.id },
        data: { contentHash: contentHashOf(bytes) },
      });
      done++;
    } catch (error) {
      failed++;
      console.error(
        `${row.businessKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  console.log(
    `Document hashes: ${done} written, ${failed} failed, ${rows.length} without a hash before`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
