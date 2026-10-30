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
  o("153", "Contractual receivables", "Kontraktsfordringar", "Kund"),
  o("244", "Accounts payable – trade", "Leverantörsskulder", "Lev"),
  o("300", "Sales within Sweden", "Försäljning inom Sverige", "Konsult"),
  o("501", "Premises rent", "Lokalhyra", "Lokal", true),
  o("580", "Travel expenses", "Resekostnader", "Tr"),
  o("653", "Accounting services", "Redovisningstjänster", "Acc"),
  o("654", "IT services", "IT-tjänster", "IT", true),
  o("657", "Bank charges", "Bankkostnader", null),
  o("722", "Salaries to company management", "Löner till företagsledare", "Lön"),
  o("891", "Tax on the year's profit", "Skatt som belastar årets resultat", null),
];

const codes = (gs: ReturnType<typeof groupBasOptions>) =>
  gs.map((g) => [g.key, g.items.map((i) => i.code)]);

describe("matchesBas", () => {
  it("a number matches the code's start only", () => {
    expect(matchesBas(CHART[6] as BasOption, "65")).toBe(true);
    expect(matchesBas(CHART[6] as BasOption, "654")).toBe(true);
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
      ["favourites", ["501", "654"]],
      ["56", ["580", "653", "657"]],
      ["7", ["722"]],
      ["8", ["891"]],
      ["1", ["153"]],
      ["2", ["244"]],
      ["3", ["300"]],
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
        { code: "654", source: "partner" },
        { code: "654", source: "history" },
        { code: "999", source: "rule" }, // not in the tenant's active set: left out
        { code: "653", source: "proposal", reason: "Rule “Accountant”" },
      ],
    });
    expect(codes(groups)[0]).toEqual(["suggested", ["654", "653"]]);
    expect(groups[0]?.items[0]?.suggestion).toEqual({ code: "654", source: "partner" });
    expect(groups[0]?.items[1]?.suggestion?.reason).toBe("Rule “Accountant”");
    const all = groups.flatMap((g) => g.items.map((i) => i.code));
    expect(new Set(all).size).toBe(all.length);
    expect(codes(groups)[1]).toEqual(["favourites", ["501"]]);
  });

  it("a query reads the chart in its order: favourites do not jump ahead, empty groups go", () => {
    expect(codes(groupBasOptions(CHART, { query: "services", direction: "cost" }))).toEqual([
      ["56", ["653", "654"]],
    ]);
    expect(groupBasOptions(CHART, { query: "nothing like it" })).toEqual([]);
  });
});

describe("the small rules", () => {
  it("classes 5 and 6 are one group; the class from the code when not given", () => {
    expect(classGroupOf({ code: "501" })).toBe("56");
    expect(classGroupOf({ code: "654" })).toBe("56");
    expect(classGroupOf({ code: "722", classNum: 7 })).toBe("7");
    expect(foldText("  Försäljning   inom ")).toBe("forsaljning inom");
  });
});
