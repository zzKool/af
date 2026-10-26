import { describe, expect, it } from "vitest";
import {
  amountEquals,
  hasExactKey,
  orderGroups,
  parseAmount,
  parseSearchQuery,
  rankOf,
  seeAllHref,
  toGroup,
} from "./query";
import { RANK, type SearchHit } from "./types";

describe("parseAmount — the formats people type", () => {
  it.each([
    ["1250", "1250.00"],
    ["1 250", "1250.00"],
    ["1 250", "1250.00"],
    ["1 250", "1250.00"],
    ["1250.00", "1250.00"],
    ["1250,00", "1250.00"],
    ["1'250", "1250.00"],
    ["1’250.50", "1250.50"],
    ["1,250.00", "1250.00"],
    ["1.250,00", "1250.00"],
    ["1.250", "1250.00"],
    ["1,250", "1250.00"],
    ["12.5", "12.50"],
    ["12,50", "12.50"],
    ["-1250", "1250.00"],
    ["−1 250.00", "1250.00"],
    ["1 234 567.89", "1234567.89"],
    ["0.5", "0.50"],
  ])("%s → %s", (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it.each(["VA23-INV-001", "Ex213", "1.2.3", "abc", "", "1250.123", "1-250"])(
    "%s is not an amount",
    (raw) => {
      expect(parseAmount(raw)).toBeNull();
    },
  );
});

describe("parseSearchQuery", () => {
  it("is null under two characters", () => {
    expect(parseSearchQuery(" V ")).toBeNull();
  });
  it("keeps the text and reads the amount", () => {
    expect(parseSearchQuery(" 1'250 ")).toEqual({ text: "1'250", amount: "1250.00" });
    expect(parseSearchQuery("Acme")).toEqual({ text: "Acme", amount: null });
  });
});

describe("amountEquals", () => {
  it("ignores sign and scale", () => {
    expect(amountEquals("-1250.00", "1250.00")).toBe(true);
    expect(amountEquals("1250", "1250.00")).toBe(true);
    expect(amountEquals("1250.01", "1250.00")).toBe(false);
  });
});

describe("rankOf", () => {
  const q = (text: string) => parseSearchQuery(text) ?? { text, amount: null };

  it("exact key, then prefix, then amount, then name, then text", () => {
    expect(rankOf(q("va23-inv-001"), { keys: ["VA23-INV-001"] })).toBe(RANK.exactKey);
    expect(rankOf(q("VA23-INV"), { keys: ["VA23-INV-001"] })).toBe(RANK.keyPrefix);
    expect(rankOf(q("1 250"), { keys: ["X"], amounts: ["-1250.00"] })).toBe(RANK.amount);
    expect(rankOf(q("INV-00"), { keys: ["VA23-INV-001"] })).toBe(RANK.keyOrName);
    expect(rankOf(q("acme"), { names: ["ACME Consulting AB"] })).toBe(RANK.keyOrName);
    expect(rankOf(q("spotify"), { texts: ["Kortköp SPOTIFY P1234"] })).toBe(RANK.text);
    expect(rankOf(q("nothing"), { keys: ["A"], names: ["B"], texts: ["C"] })).toBeNull();
  });

  it("folds accents", () => {
    expect(rankOf(q("kortkop"), { texts: ["Kortköp"] })).toBe(RANK.text);
  });
});

const hit = (over: Partial<SearchHit>): SearchHit => ({
  kind: "invoice",
  id: "x",
  key: "K",
  label: "L",
  date: "2026-01-01",
  href: "/x",
  rank: RANK.text,
  ...over,
});

describe("toGroup / orderGroups", () => {
  it("best rank first, then newest, at most five, more when cut", () => {
    const hits = [
      hit({ id: "a", rank: RANK.text, date: "2026-05-01" }),
      hit({ id: "b", rank: RANK.exactKey, date: "2023-01-01" }),
      hit({ id: "c", rank: RANK.text, date: "2026-06-01" }),
      hit({ id: "d", rank: RANK.text }),
      hit({ id: "e", rank: RANK.text }),
      hit({ id: "f", rank: RANK.text }),
    ];
    const g = toGroup("invoice", hits, "/invoices?q=x");
    expect(g.hits.map((h) => h.id).slice(0, 3)).toEqual(["b", "c", "a"]);
    expect(g.hits).toHaveLength(5);
    expect(g.more).toBe(true);
  });

  it("drops empty groups, best hit first, ties in kind order", () => {
    const partner = toGroup("partner", [hit({ kind: "partner", rank: RANK.keyOrName })], "/p");
    const bank = toGroup(
      "bank_transaction",
      [hit({ kind: "bank_transaction", rank: RANK.amount })],
      "/b",
    );
    const invoice = toGroup("invoice", [hit({ rank: RANK.keyOrName })], "/i");
    const empty = toGroup("document", [], "/d");
    expect(orderGroups([partner, bank, invoice, empty]).map((g) => g.kind)).toEqual([
      "bank_transaction",
      "partner",
      "invoice",
    ]);
    expect(hasExactKey(partner)).toBe(false);
  });

  it("see all keeps the query in the URL", () => {
    expect(seeAllHref("/invoices", "VA23 INV")).toBe("/invoices?q=VA23%20INV");
  });
});
