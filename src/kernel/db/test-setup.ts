import { execSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// Superuser URL for migrations (needs CREATE ROLE privileges)
const MIGRATION_URL =
  process.env.DATABASE_TEST_MIGRATION_URL ||
  "postgresql://defterfab:test@localhost:5433/defterfab_test";

// App role URL for RLS-enforced operations
const APP_URL =
  process.env.DATABASE_TEST_URL ||
  process.env.DATABASE_URL ||
  "postgresql://defterfab_app:app@localhost:5433/defterfab_test";

// Override DATABASE_URL so app code uses the test database
process.env.DATABASE_URL = APP_URL;

let pool: Pool;
let prisma: PrismaClient;

beforeAll(async () => {
  // Run migrations using superuser (needs CREATE ROLE, ALTER TABLE etc.).
  // SKIP_MIGRATE_DEPLOY=1: the caller already applied prisma/migrations (environments without the Prisma engine).
  if (!process.env.SKIP_MIGRATE_DEPLOY)
    execSync("npx prisma migrate deploy", {
      env: {
        ...process.env,
        DATABASE_URL: MIGRATION_URL,
        DATABASE_MIGRATION_URL: MIGRATION_URL,
      },
      stdio: "pipe",
    });

  // Create app pool using non-superuser role (RLS enforced)
  pool = new Pool({ connectionString: APP_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

export { APP_URL, MIGRATION_URL };
