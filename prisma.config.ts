import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env.local first, then .env.test as fallback
config({ path: ".env.local" });
config({ path: ".env.test" });

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Use superuser URL for migrations (needs CREATE ROLE, ALTER TABLE etc.)
    // Falls back to DATABASE_URL if MIGRATION_URL not set
    url: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL,
  },
});
