import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Architecture guard — enforces the import rules of docs/constitution.md §2.
 *
 * Layout:
 *   src/kernel/*       cross-cutting infrastructure (db, auth, audit, money, clock, storage, ocr, jobs, ui…)
 *   src/modules/<m>/*  one feature module each; `<entity>.ts` = service, `<entity>.actions.ts` = server actions,
 *                      `components/` = React, `stores/` = client state, `jobs/` = background handlers
 *   src/app/*          Next.js routes only
 *   src/components/ui  shadcn primitives (kernel UI kit, kept where the shadcn CLI expects them)
 *   src/lib/utils.ts   `cn()` for shadcn (kernel)
 *
 * Rules enforced here (3a). The `index.ts`-only rule between modules arrives with 3b (DTO surfaces).
 */

function findFiles(dir: string, exts: string[], ignore?: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(
      (e) =>
        e.isFile() &&
        exts.some((x) => e.name.endsWith(x)) &&
        (!ignore || !ignore.test(join(e.parentPath, e.name))),
    )
    .map((e) => join(e.parentPath, e.name));
}

function imports(content: string): string[] {
  const out: string[] = [];
  const re =
    /(?:import|export)\s[^'"]*?\sfrom\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of content.matchAll(re)) out.push(m[1] ?? m[2]);
  return out;
}

const TEST_FILE = /\.(test|spec)\.tsx?$/;
const SERVER_FILE = /\/(components|stores)\/|\.tsx$|\.actions\.ts$|\/(index|ui|queries|types)\.ts$/; // what is NOT a service file

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

describe("Architecture guard: layering (kernel ← modules ← app)", () => {
  test("kernel never imports from modules/ or app/", () => {
    const files = findFiles("src/kernel", [".ts", ".tsx"], TEST_FILE);
    expect(files.length, "Guard found no kernel files to scan").toBeGreaterThan(0);
    for (const file of files) {
      for (const spec of imports(readFileSync(file, "utf-8"))) {
        expect(
          /^@\/(modules|app)\//.test(spec) || /\.\.\/(modules|app)\//.test(spec),
          `kernel file ${file} imports ${spec}`,
        ).toBe(false);
      }
    }
  });

  test("modules never import from app/ or from legacy src/server, src/hooks, src/types", () => {
    const files = findFiles("src/modules", [".ts", ".tsx"], TEST_FILE);
    expect(files.length, "Guard found no module files to scan").toBeGreaterThan(0);
    for (const file of files) {
      for (const spec of imports(readFileSync(file, "utf-8"))) {
        expect(
          /^@\/(app|server|hooks|types)\//.test(spec),
          `module file ${file} imports ${spec}`,
        ).toBe(false);
      }
    }
  });

  test("app/ routes import only kernel, modules and shadcn primitives (no legacy paths)", () => {
    const files = findFiles("src/app", [".ts", ".tsx"], TEST_FILE);
    expect(files.length, "Guard found no app files to scan").toBeGreaterThan(0);
    for (const file of files) {
      for (const spec of imports(readFileSync(file, "utf-8"))) {
        if (!spec.startsWith("@/")) continue;
        expect(
          /^@\/(kernel|modules|components\/ui|lib\/utils|generated)\b/.test(spec),
          `app file ${file} imports ${spec}`,
        ).toBe(true);
      }
    }
  });

  test("legacy folders are gone", () => {
    for (const legacy of [
      "src/server",
      "src/hooks",
      "src/types",
      "src/components/domain",
      "src/components/shared",
    ]) {
      expect(findFiles(legacy, [".ts", ".tsx"]).length, `${legacy} still has files`).toBe(0);
    }
  });
});

describe("Architecture guard: module surfaces (3b)", () => {
  const moduleOf = (file: string) => file.match(/^src\/modules\/([^/]+)\//)?.[1] ?? null;
  const allSrc = () =>
    findFiles("src/app", [".ts", ".tsx"], TEST_FILE)
      .concat(findFiles("src/modules", [".ts", ".tsx"], TEST_FILE))
      .concat(findFiles("src/kernel", [".ts", ".tsx"], TEST_FILE));

  test("outside a module, only its index (@/modules/<m>) or ui (@/modules/<m>/ui) surface is imported", () => {
    for (const file of allSrc()) {
      const own = moduleOf(file);
      for (const spec of imports(readFileSync(file, "utf-8"))) {
        const m = spec.match(/^@\/modules\/([^/"]+)(\/.*)?$/);
        if (!m || m[1] === own) continue;
        expect(
          m[2] === undefined || m[2] === "/ui",
          `${file} imports ${spec} — use @/modules/${m[1]} or @/modules/${m[1]}/ui`,
        ).toBe(true);
      }
    }
  });

  test("client components never import a module's server surface", () => {
    for (const file of allSrc()) {
      const content = readFileSync(file, "utf-8");
      if (!/^\s*["']use client["']/m.test(content)) continue;
      for (const spec of imports(content)) {
        expect(
          /^@\/modules\/[^/"]+(\/index)?$/.test(spec),
          `client component ${file} imports server surface ${spec} — use @/modules/<m>/ui`,
        ).toBe(false);
      }
    }
  });

  test("every module has index.ts and ui.ts; ui exports only components/actions/types; index never exports components", () => {
    const modules = readdirSync("src/modules", { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(modules.length).toBeGreaterThan(0);
    for (const m of modules) {
      const index = `src/modules/${m}/index.ts`;
      const ui = `src/modules/${m}/ui.ts`;
      expect(existsSync(index), `${index} missing`).toBe(true);
      expect(existsSync(ui), `${ui} missing`).toBe(true);
      for (const spec of imports(readFileSync(ui, "utf-8"))) {
        expect(
          /^\.\/components\/|^\.\/types$|\.actions$/.test(spec),
          `${ui} exports ${spec} — ui.ts may only export components, actions and types (stores stay internal)`,
        ).toBe(true);
      }
      for (const spec of imports(readFileSync(index, "utf-8"))) {
        expect(/^\.\/(components|stores)\//.test(spec), `${index} exports ${spec}`).toBe(false);
      }
      for (const surface of [index, ui, `src/modules/${m}/types.ts`]) {
        if (!existsSync(surface)) continue;
        expect(
          readFileSync(surface, "utf-8").includes("@/generated/prisma"),
          `${surface} references Prisma types`,
        ).toBe(false);
      }
    }
  });
});

describe("Architecture guard: linking owns the link table (3c)", () => {
  test("only src/modules/linking writes links", () => {
    const files = findFiles("src/kernel", [".ts", ".tsx"], TEST_FILE)
      .concat(findFiles("src/modules", [".ts", ".tsx"], TEST_FILE))
      .concat(findFiles("src/app", [".ts", ".tsx"], TEST_FILE))
      .filter((f) => !f.startsWith("src/modules/linking/"));
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(
        /\.link\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(content),
        `${file} writes the links table — only modules/linking may`,
      ).toBe(false);
    }
  });
});

describe("Architecture guard: services are framework-free", () => {
  const serviceFiles = () =>
    findFiles("src/modules", [".ts"], TEST_FILE)
      .filter((f) => !SERVER_FILE.test(f))
      .concat(
        findFiles("src/kernel", [".ts"], TEST_FILE).filter(
          (f) => !/\/(ui|i18n|stores|nav|actions|auth)\//.test(f) && !SERVER_FILE.test(f),
        ),
      );

  test("services never import next/*, react or components", () => {
    const files = serviceFiles();
    expect(files.length, "Guard found no service files to scan").toBeGreaterThan(0);
    for (const file of files) {
      for (const spec of imports(readFileSync(file, "utf-8"))) {
        expect(
          /^(next\/|next$|react$|react\/|react-dom)/.test(spec) || /\/components\//.test(spec),
          `service ${file} imports ${spec}`,
        ).toBe(false);
      }
    }
  });
});

describe("Architecture guard: no console.* in server code", () => {
  test("server code must use the Pino logger, not console.*", () => {
    const files = findFiles("src/kernel", [".ts"], /\.(test|spec)\.ts$|\/ui\//).concat(
      findFiles("src/modules", [".ts"], /\.(test|spec)\.ts$|\/(components|stores)\//),
    );
    expect(files.length, "Guard found no server files to scan").toBeGreaterThan(0);
    for (const file of files) {
      const lines = readFileSync(file, "utf-8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
        expect(
          /\bconsole\.(log|warn|error|info|debug)\b/.test(line),
          `console.* found in ${file} line ${i + 1}: ${line}`,
        ).toBe(false);
      }
    }
  });
});
