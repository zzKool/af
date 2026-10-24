import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * One-client guard — F53. A transaction (`withTenantTransaction`, `withTenantConnection`) holds one
 * pg client, and a pg client runs one query at a time: `Promise.all([a(tx), b(tx)])` sends the second
 * query while the first runs. pg queues it (nothing is gained) and warns "client.query() while already
 * executing", which pg@9 removes. So the awaits inside a transaction go one after the other; a list goes
 * through `mapInOrder` (kernel/db/tenant-client).
 *
 * Rule: a file that touches a transaction — names `tx`, `TransactionClient`, `withTenantTransaction`
 * or `withTenantConnection` — has no `Promise.all` / `allSettled` / `any` / `race`. File-wide on
 * purpose: a closure over `tx` inside `Promise.all([load(), …])` names no `tx` at the call.
 *
 * The exceptions below run their parallel work on separate clients. A new one is listed here with
 * its reason — never to let a `tx` through.
 *
 * Scanned: `src/**` .ts/.tsx, without tests, `__fixtures__`, `kernel/test-utils`, `generated` and
 * comment lines.
 */

const ALLOWED: Record<string, { count: number; why: string }> = {
  "src/app/(app)/layout.tsx": {
    count: 2,
    why: "one withTenantTransaction per membership (each its own client); then the pool beside the sidebar counts' own withTenantTransaction (F72)",
  },
  "src/app/(app)/settings/rates/page.tsx": {
    count: 1,
    why: "the global rate table on the pool beside its own withTenantTransaction",
  },
  "src/app/(app)/links/[type]/[id]/page.tsx": {
    count: 1,
    why: "awaits the route's params and searchParams, before any transaction",
  },
  "src/instrumentation.ts": {
    count: 1,
    why: "loads the job modules (dynamic imports) at boot, no query",
  },
};

const ROOT = process.cwd();
const SKIP = /\.(test|spec)\.tsx?$|\/__fixtures__\/|^src\/kernel\/test-utils\/|^src\/generated\//;
const COMMENT = /^(\/\/|\*|\/\*)/;
const TOUCHES_TX =
  /\btx\b|\bTransactionClient\b|\bwithTenantTransaction\b|\bwithTenantConnection\b/;
const PARALLEL = /\bPromise\s*\.\s*(all|allSettled|any|race)\s*\(/g;

function sourceFiles(): string[] {
  return readdirSync(join(ROOT, "src"), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => relative(ROOT, join(e.parentPath, e.name)).replaceAll("\\", "/"))
    .filter((f) => !SKIP.test(f));
}

function codeLines(content: string): { n: number; line: string }[] {
  return content
    .split("\n")
    .map((line, i) => ({ n: i + 1, line }))
    .filter(({ line }) => !COMMENT.test(line.trim()));
}

describe("One-client guard (F53): no Promise.all over a transaction client", () => {
  const files = sourceFiles();

  test("a file that touches a transaction runs its queries one after the other", () => {
    const violations: string[] = [];
    for (const file of files) {
      const lines = codeLines(readFileSync(join(ROOT, file), "utf-8"));
      if (!lines.some(({ line }) => TOUCHES_TX.test(line))) continue;
      const hits = lines.filter(({ line }) => line.match(PARALLEL));
      const count = hits.reduce((s, { line }) => s + (line.match(PARALLEL)?.length ?? 0), 0);
      if (count > (ALLOWED[file]?.count ?? 0)) {
        for (const { n, line } of hits) violations.push(`${file}:${n}  ${line.trim()}`);
      }
    }
    expect(
      violations,
      "Promise.all over one transaction client (F53): await one after the other, or mapInOrder for a list",
    ).toEqual([]);
  });

  test("every exception is still needed (the list only shrinks)", () => {
    const stale: string[] = [];
    for (const [file, { count }] of Object.entries(ALLOWED)) {
      let content = "";
      try {
        content = readFileSync(join(ROOT, file), "utf-8");
      } catch {
        stale.push(`${file}: gone — delete its entry`);
        continue;
      }
      const found = codeLines(content).reduce(
        (s, { line }) => s + (line.match(PARALLEL)?.length ?? 0),
        0,
      );
      if (found < count) stale.push(`${file}: ${found} < ${count} — lower its entry`);
    }
    expect(stale).toEqual([]);
  });

  test("the rule catches what F53 fixed (self-check)", () => {
    const sample = [
      "export async function load(tx: TransactionClient) {",
      "  const [a, b] = await Promise.all([one(tx), two(tx)]);",
      "}",
    ].join("\n");
    const lines = codeLines(sample);
    expect(lines.some(({ line }) => TOUCHES_TX.test(line))).toBe(true);
    expect(lines.filter(({ line }) => line.match(PARALLEL))).toHaveLength(1);
    // a comment that mentions it is not code
    expect(codeLines("// never Promise.all([a(tx), b(tx)])")).toEqual([]);
  });
});
