// F125: what a query matches in the BAS picker, and the order of its groups — the owner's 2026-10-30 report: the
// list read "501, 654, 153, 244, 300 …" (alias first, then favourites, then numbers), assets mixed with revenue and
// costs, Swedish only.
import { describe, expect, it } from "vitest";
import type { BasOption } from "../types";
import { classGroupOf, foldText, groupBasOptions, matchesBas } from "./bas-picker-model";

const o = (code: string, name: string, nameSv: string | null, alias: string | null, fav = false) =>
  ({
    code,
    label: `${code} · ${name}${alias ? ` (${alias})` : ""}`,
    name,
    nameSv,
    alias,
    classNum: Number(code[0]),
    favourite: fav,
  }) satisfies BasOption;

const CHART: BasOption[] = [
  o("1530", "Contractual receivables", "Kontraktsfordringar", "Kund"),
  o("2440", "Accounts payable – trade", "Leverantörsskulder", "Lev"),
  o("3000", "Sales within Sweden", "Försäljning inom Sverige", "Konsult"),
  o("5010", "Premises rent", "Lokalhyra", "Lokal", true),
  o("5800", "Travel expenses", "Resekostnader", "Tr"),
  o("6530", "Accounting services", "Redovisningstjänster", "Acc"),
  o("6540", "IT services", "IT-tjänster", "IT", true),
  o("6570", "Bank charges", "Bankkostnader", null),
  o("7220", "Salaries to company management", "Löner till företagsledare", "Lön"),
  o("8910", "Tax on the year's profit", "Skatt som belastar årets resultat", null),
];

const codes = (gs: ReturnType<typeof groupBasOptions>) =>
  gs.map((g) => [g.key, g.items.map((i) => i.code)]);

describe("matchesBas", () => {
  it("a number matches the code's start only", () => {
    expect(matchesBas(CHART[6] as BasOption, "65")).toBe(true);
    expect(matchesBas(CHART[6] as BasOption, "6540")).toBe(true);
    expect(matchesBas(CHART[6] as BasOption, "54")).toBe(false);
  });

  it("words match the English name, the Swedish name or the short code — any order, any case, accents off", () => {
    const it_ = CHART[6] as BasOption;
    expect(matchesBas(it_, "it serv")).toBe(true);
    expect(matchesBas(it_, "tjanster")).toBe(true); // tjänster without the umlaut
    expect(matchesBas(it_, "services it")).toBe(true);
    expect(matchesBas(CHART[5] as BasOption, "acc")).toBe(true);
    expect(matchesBas(CHART[3] as BasOption, "LOKALHYRA")).toBe(true);
    expect(matchesBas(CHART[3] as BasOption, "rent bank")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(CHART.every((c) => matchesBas(c, "  "))).toBe(true);
  });
});

describe("groupBasOptions", () => {
  it("a cost: favourites, then the cost classes in chart order, then the balance sheet and revenue", () => {
    expect(codes(groupBasOptions(CHART, { direction: "cost" }))).toEqual([
      ["favourites", ["5010", "6540"]],
      ["56", ["5800", "6530", "6570"]],
      ["7", ["7220"]],
      ["8", ["8910"]],
      ["1", ["1530"]],
      ["2", ["2440"]],
      ["3", ["3000"]],
    ]);
  });

  it("no direction: the chart's own order", () => {
    expect(codes(groupBasOptions(CHART)).map(([k]) => k)).toEqual([
      "favourites",
      "1",
      "2",
      "3",
      "56",
      "7",
      "8",
    ]);
  });

  it("the suggestions come first, with their source, and each account appears once", () => {
    const groups = groupBasOptions(CHART, {
      direction: "cost",
      suggestions: [
        { code: "6540", source: "partner" },
        { code: "6540", source: "history" },
        { code: "999", source: "rule" }, // not in the tenant's active set: left out
        { code: "6530", source: "proposal", reason: "Rule “Accountant”" },
      ],
    });
    expect(codes(groups)[0]).toEqual(["suggested", ["6540", "6530"]]);
    expect(groups[0]?.items[0]?.suggestion).toEqual({ code: "6540", source: "partner" });
    expect(groups[0]?.items[1]?.suggestion?.reason).toBe("Rule “Accountant”");
    const all = groups.flatMap((g) => g.items.map((i) => i.code));
    expect(new Set(all).size).toBe(all.length);
    expect(codes(groups)[1]).toEqual(["favourites", ["5010"]]);
  });

  it("a query reads the chart in its order: favourites do not jump ahead, empty groups go", () => {
    expect(codes(groupBasOptions(CHART, { query: "services", direction: "cost" }))).toEqual([
      ["56", ["6530", "6540"]],
    ]);
    expect(groupBasOptions(CHART, { query: "nothing like it" })).toEqual([]);
  });
});

describe("the small rules", () => {
  it("classes 5 and 6 are one group; the class from the code when not given", () => {
    expect(classGroupOf({ code: "5010" })).toBe("56");
    expect(classGroupOf({ code: "6540" })).toBe("56");
    expect(classGroupOf({ code: "7220", classNum: 7 })).toBe("7");
    expect(foldText("  Försäljning   inom ")).toBe("forsaljning inom");
  });
});

describe("D68 (F148): BAS's account groups in the picker", () => {
  const withGroups = CHART.map((x) => ({
    ...x,
    groupCode: x.code.slice(0, 2),
    groupName:
      (
        {
          "65": "Other external services",
          "58": "Travel expenses",
          "50": "Premises costs",
        } as Record<string, string>
      )[x.code.slice(0, 2)] ?? null,
  }));

  it("inside a class, one group per BAS account group, in code order", () => {
    const gs = groupBasOptions(withGroups, { query: "6" });
    expect(gs.map((g) => [g.kind, g.key, g.items.map((i) => i.code)])).toEqual([
      ["group", "65", ["6530", "6540", "6570"]],
    ]);
    expect(gs[0]?.kind === "group" && gs[0].name).toBe("Other external services");
  });

  it("a word of the group's name finds its accounts (`external` → group 65)", () => {
    const found = withGroups.filter((x) => matchesBas(x, "external")).map((x) => x.code);
    expect(found).toEqual(["6530", "6540", "6570"]);
  });

  it("options without groups keep the class grouping (older callers)", () => {
    expect(groupBasOptions(CHART, { query: "6" }).map((g) => g.kind)).toEqual(["class"]);
  });
});
