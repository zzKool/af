import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Real-names guard — F132 (D51). The repo is public; the owner's real data never enters it. The
 * owner's real main client's name sat in fixtures, tests and specs since the first slice; F132
 * replaced it with an invented client (`Lakeside Assurance SA`, short code `LK`). This guard keeps it
 * out — without writing it here: the names are stored as the SHA-256 of their lowercased form, and
 * every word of every tracked text file is hashed and compared.
 *
 * Scanned: `git ls-files` (so `private/`, gitignored, is never read), text files only (no NUL byte
 * in the first 8 KB). A word is a run of letters / digits, split on camelCase too (`fooBar` → foo,
 * bar), lowercased. A hit names the file and line, never the word.
 *
 * A new entry: `printf %s '<name, lowercased>' | sha256sum` — one word per entry; a multi-word name
 * is caught by its most distinctive word.
 */

const FORBIDDEN = new Set<string>([
  // the owner's real main client (F132)
  "aa4713f317439f63006d6334e2c123e542ec25663bebb5b7804104740ed35b79",
]);

const ROOT = process.cwd();
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz|xlsx|docx)$/i;

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** The words of a text: camelCase split, lowercased, letters and digits only. */
function wordsOf(text: string): string[] {
  return (
    text
      .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** `file:line` for every word whose hash is in `hashes`. */
function findHashed(file: string, text: string, hashes: Set<string>): string[] {
  const hits: string[] = [];
  const seen = new Map<string, boolean>();
  text.split("\n").forEach((line, i) => {
    for (const w of wordsOf(line)) {
      let bad = seen.get(w);
      if (bad === undefined) {
        bad = hashes.has(sha256(w));
        seen.set(w, bad);
      }
      if (bad) {
        hits.push(`${file}:${i + 1}`);
        return;
      }
    }
  });
  return hits;
}

function trackedTextFiles(): { file: string; text: string }[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf-8" });
  return out
    .split("\0")
    .filter((f) => f && !f.startsWith("private/") && !BINARY_EXT.test(f))
    .filter((f) => existsSync(join(ROOT, f)))
    .flatMap((file) => {
      const buf = readFileSync(join(ROOT, file));
      if (buf.subarray(0, 8192).includes(0)) return [];
      return [{ file, text: buf.toString("utf-8") }];
    });
}

describe("Real-names guard (F132, D51): no real client name in tracked files", () => {
  test("the matcher finds a hashed word, whatever its case or surroundings", () => {
    const probe = new Set([sha256("zzprobe")]);
    expect(findHashed("a.ts", 'x\nconst n = "ZZPROBE Assurance";', probe)).toEqual(["a.ts:2"]);
    expect(findHashed("b.md", "mail anne@zzprobe.example", probe)).toEqual(["b.md:1"]);
    expect(findHashed("c.ts", "const zzprobeName = 1;", probe)).toEqual(["c.ts:1"]);
    expect(findHashed("d.ts", "zzprobes and zzprobe2 differ", probe)).toEqual([]);
  });

  test("no tracked file holds a forbidden name", () => {
    const files = trackedTextFiles();
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap(({ file, text }) => findHashed(file, text, FORBIDDEN));
    expect(
      hits,
      "a real name (D51): replace it with the invented client (Lakeside Assurance SA, LK)",
    ).toEqual([]);
  });
});
