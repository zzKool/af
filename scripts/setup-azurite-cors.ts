/**
 * Sets CORS rules on the local Azurite blob service so the browser
 * can fetch blobs directly (e.g., PDF preview via react-pdf).
 *
 * Run once after `docker compose up -d azurite`, or via `npm run dev:setup`.
 */

import { BlobServiceClient } from "@azure/storage-blob";
import { config } from "dotenv";

config({ path: ".env.local" });

const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!connStr) {
  console.error("AZURE_STORAGE_CONNECTION_STRING not set — skipping CORS setup");
  process.exit(0);
}

const blobService = BlobServiceClient.fromConnectionString(connStr);

async function main() {
  await blobService.setProperties({
    cors: [
      {
        allowedOrigins: "*",
        allowedMethods: "GET,HEAD,OPTIONS",
        allowedHeaders: "*",
        exposedHeaders: "*",
        maxAgeInSeconds: 3600,
      },
    ],
  });
  console.log("Azurite CORS rules configured");
}

main().catch((err) => {
  console.error("Failed to set CORS:", err.message);
  process.exit(1);
});
