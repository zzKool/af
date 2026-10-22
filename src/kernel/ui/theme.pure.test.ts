import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTheme } from "./theme";

describe("parseTheme — light, dark, or follow the system", () => {
  it("keeps light and dark", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("anything else (no cookie, an old or tampered value) follows the system", () => {
    for (const v of [null, undefined, "", "system", "Dark", "blue"])
      expect(parseTheme(v)).toBeNull();
  });
});

describe("globals.css — the dark tokens are written twice and must stay equal (D43)", () => {
  const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
  const declarations = (block: string) =>
    block
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean);

  it("the OS-dark block and the forced-dark block declare the same tokens", () => {
    const fromOs = css.match(
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/,
    );
    const forced = css.match(/\n:root\[data-theme="dark"\] \{([^}]*)\}/);
    expect(fromOs, "the OS-dark block").not.toBeNull();
    expect(forced, "the forced-dark block").not.toBeNull();
    expect(declarations(forced?.[1] ?? "")).toEqual(declarations(fromOs?.[1] ?? ""));
    expect(declarations(forced?.[1] ?? "")).toContain("color-scheme: dark");
  });
});
