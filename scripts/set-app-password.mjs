// The app role's password from the environment (F105 — audit 2026-10-27 D4). The migrations create `af_app`
// with the password `app` (the init migration cannot read a secret); this step, run by the migrate image right
// after `prisma migrate deploy`, sets it to AF_APP_PASSWORD — the same value DATABASE_URL carries. Without the
// variable nothing changes (dev, CI, the test databases keep `app`). Runs as the migration role.
import pg from "pg";

const password = process.env.AF_APP_PASSWORD;
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;

if (!password) {
  console.log("AF_APP_PASSWORD not set — af_app keeps its password");
  process.exit(0);
}
if (!url) {
  console.error("DATABASE_MIGRATION_URL (or DATABASE_URL) is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  // ALTER ROLE takes no bind parameters: the literal is escaped by the driver (quotes doubled, E'' when needed)
  await client.query(`ALTER ROLE af_app WITH PASSWORD ${client.escapeLiteral(password)}`);
  console.log("af_app password set from AF_APP_PASSWORD");
} finally {
  await client.end();
}
