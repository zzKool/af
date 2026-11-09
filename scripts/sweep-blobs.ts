// The laptop half of scripts/reset-working-data.sh: delete every blob in the local Azurite container that no
// document row points at any more. The list of the paths to keep comes from the database (one per line).
//
//   npx tsx scripts/sweep-blobs.ts <keep-list.txt>
import { readFileSync } from "node:fs";
import { BlobServiceClient } from "@azure/storage-blob";
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const listFile = process.argv[2];
  if (!listFile) throw new Error("usage: npx tsx scripts/sweep-blobs.ts <keep-list.txt>");
  const keep = new Set(
    readFileSync(listFile, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) throw new Error("AZURE_STORAGE_CONNECTION_STRING not set (.env.local)");
  const container = BlobServiceClient.fromConnectionString(connStr).getContainerClient(
    process.env.AZURE_STORAGE_CONTAINER ?? "documents",
  );
  if (!(await container.exists())) {
    console.log("  no container — nothing to sweep");
    return;
  }
  let deleted = 0;
  let kept = 0;
  for await (const blob of container.listBlobsFlat()) {
    if (keep.has(blob.name)) kept++;
    else {
      await container.deleteBlob(blob.name);
      deleted++;
    }
  }
  console.log(`  ${deleted} file(s) deleted, ${kept} kept`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
