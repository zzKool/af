// The documents move from the Blob store into the folder (F107, D61) — run by the migrate container after
// `prisma migrate deploy`, as the migration role, when the app is on the filesystem driver and a Blob connection
// string is still set (the old Azurite or an Azure account). Idempotent: a document already on `fs://` is skipped;
// a file already there with the right size is not downloaded again. Nothing is deleted from the source — the old
// volume goes when the owner has checked the app (and a backup) against the folder. Plain JS: the migrate image
// has node_modules but no TypeScript and no source tree.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import pg from "pg";

const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
const driver = (process.env.STORAGE_DRIVER || "blob").trim().toLowerCase();
const dir = process.env.STORAGE_DIR;
const container = process.env.AZURE_STORAGE_CONTAINER || "documents";
const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;

if (driver !== "fs") {
  console.log("storage driver is not fs — nothing to move");
  process.exit(0);
}
if (!connStr) {
  console.log("no AZURE_STORAGE_CONNECTION_STRING — nothing to move from");
  process.exit(0);
}
if (!url || !dir) {
  console.error("DATABASE_MIGRATION_URL and STORAGE_DIR are required");
  process.exit(1);
}

const base = resolve(dir);
const inside = (blobPath) => {
  const target = resolve(base, blobPath);
  if (target !== base && !target.startsWith(base + sep))
    throw new Error(`escapes the folder: ${blobPath}`);
  return target;
};
const blobPathOf = (blobUrl) => {
  const clean = blobUrl.split("?")[0];
  const i = clean.indexOf(`/${container}/`);
  if (i === -1) throw new Error(`cannot read the blob path from ${blobUrl}`);
  return clean.substring(i + container.length + 2);
};

const blobs = BlobServiceClient.fromConnectionString(connStr).getContainerClient(container);
const pool = new pg.Pool({ connectionString: url });
try {
  await mkdir(base, { recursive: true });
  const { rows } = await pool.query(
    `SELECT id, blob_url, file_size FROM documents WHERE blob_url NOT LIKE 'fs://%' ORDER BY created_at`,
  );
  let moved = 0;
  for (const row of rows) {
    const blobPath = blobPathOf(row.blob_url);
    const target = inside(blobPath);
    const existing = await stat(target).catch(() => null);
    if (!existing || existing.size !== Number(row.file_size)) {
      const bytes = await blobs.getBlockBlobClient(blobPath).downloadToBuffer();
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    await pool.query(`UPDATE documents SET blob_url = $1 WHERE id = $2`, [
      `fs://${container}/${blobPath}`,
      row.id,
    ]);
    moved++;
  }
  console.log(`documents: ${moved} moved to ${base}; the rest were already there`);
} finally {
  await pool.end();
}
