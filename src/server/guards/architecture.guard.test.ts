import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

function findFiles(dir: string, ext: string, ignore?: RegExp): string[] {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(ext) && (!ignore || !ignore.test(e.name)))
      .map((e) => join(e.parentPath, e.name));
  } catch {
    return [];
  }
}

describe("Architecture guard: GRANT ALL in migrations", () => {
  const migrationsDir = join(process.cwd(), "prisma/migrations");
  const initMigration = "20260309205743_init_schema_with_rls";

  test("no migration (except init) uses GRANT ALL", () => {
    const migrationDirs = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== initMigration)
      .map((e) => e.name);

    for (const dir of migrationDirs) {
      const sqlPath = join(migrationsDir, dir, "migration.sql");
      let content: string;
      try {
        content = readFileSync(sqlPath, "utf-8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("--")) continue;
        expect(
          /GRANT\s+ALL/i.test(line),
          `GRANT ALL found in ${dir}/migration.sql line ${i + 1}: ${line}`,
        ).toBe(false);
      }
    }
  });
});

describe("Architecture guard: no next/* imports in services", () => {
  test("services must not import from next/*", () => {
    const files = findFiles("src/server/services", ".ts", /\.test\.ts$/);
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(content, `next/* import found in ${file}`).not.toMatch(/import.*from\s+['"]next\//);
    }
  });
});

describe("Architecture guard: no console.* in server code", () => {
  test("server code must use Pino logger, not console.*", () => {
    const files = findFiles("src/server", ".ts", /\.(test|spec)\.ts$|seed\.ts$/);
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("//") || line.startsWith("*")) continue;
        expect(
          /\bconsole\.(log|warn|error|info|debug)\b/.test(line),
          `console.* found in ${file} line ${i + 1}: ${line}`,
        ).toBe(false);
      }
    }
  });
});
