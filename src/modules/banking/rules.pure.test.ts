// Rule matching (specs/banking US2, harvest H4): the v1 `testPatternCases` fixture + ordering + field semantics.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fieldText, firstHit, matchRule, orderRules, regexError } from "./rules";
import type { RuleMatchType, RuleText } from "./types";

const fixture = JSON.parse(
  readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "specs",
      "banking",
      "fixtures",
      "categorisation-rules-sample.json",
    ),
    "utf8",
  ),
) as {
  testPatternCases: {
    pattern: string;
    matchType: string;
    input: string[];
    matches: string[];
    nonMatches: string[];
  }[];
};

const text = (name: string, extra: Partial<RuleText> = {}): RuleText => ({
  counterpartyKey: name.toUpperCase(),
  name,
  additionalDetails: null,
  message: null,
  sender: null,
  recipient: null,
  ...extra,
});

describe("rule matching — fixture testPatternCases", () => {
  for (const c of fixture.testPatternCases) {
    it(`${c.matchType} "${c.pattern}"`, () => {
      const rule = {
        matchType: c.matchType.toLowerCase() as RuleMatchType,
        matchPattern: c.pattern,
        matchField: "name" as const,
      };
      for (const input of c.input) {
        const hit = matchRule(rule, text(input));
        expect(hit, `${c.pattern} vs ${input}`).toBe(c.matches.includes(input));
      }
    });
  }
});

describe("rule matching — semantics", () => {
  it("is case-insensitive on the chosen field; empty text never matches", () => {
    const rule = {
      matchType: "contains" as const,
      matchPattern: "openai",
      matchField: "counterparty_key" as const,
    };
    expect(matchRule(rule, text("x", { counterpartyKey: "OPENAI *CHATGPT SUBS" }))).toBe(true);
    expect(matchRule(rule, text("x", { counterpartyKey: "" }))).toBe(false);
    expect(
      matchRule(
        { ...rule, matchType: "exact", matchPattern: "" },
        text("x", { counterpartyKey: "" }),
      ),
    ).toBe(false);
  });

  it("`all` joins the five text columns with a space; `details` reads the additional details", () => {
    const t = text("", {
      name: null,
      additionalDetails: "Kortköp 260727 OPENAI",
      message: "OPENAI *CHATGPT 1234",
      sender: "2026",
      recipient: null,
    });
    expect(fieldText(t, "all")).toBe("Kortköp 260727 OPENAI OPENAI *CHATGPT 1234 2026");
    expect(fieldText(t, "details")).toBe("Kortköp 260727 OPENAI");
    expect(fieldText(t, "name")).toBe("");
    expect(
      matchRule({ matchType: "contains", matchPattern: "chatgpt", matchField: "all" }, t),
    ).toBe(true);
  });

  it("an invalid regex never matches and never throws; regexError names it", () => {
    expect(() =>
      matchRule(
        { matchType: "regex", matchPattern: "(unclosed", matchField: "name" },
        text("(unclosed"),
      ),
    ).not.toThrow();
    expect(regexError("(unclosed")).not.toBeNull();
    expect(regexError("^R[äa]nta\\b")).toBeNull();
  });

  it("orders by priority desc, then longer pattern, then newest; inactive rules drop out", () => {
    const d = (s: string) => new Date(s);
    const rules = [
      {
        id: "a",
        matchType: "contains" as const,
        matchPattern: "OPEN",
        matchField: "name" as const,
        priority: 100,
        createdAt: d("2026-01-01"),
      },
      {
        id: "b",
        matchType: "contains" as const,
        matchPattern: "OPENAI",
        matchField: "name" as const,
        priority: 100,
        createdAt: d("2026-01-01"),
      },
      {
        id: "c",
        matchType: "contains" as const,
        matchPattern: "OP",
        matchField: "name" as const,
        priority: 200,
        createdAt: d("2026-01-01"),
      },
      {
        id: "d",
        matchType: "contains" as const,
        matchPattern: "OPEN",
        matchField: "name" as const,
        priority: 100,
        createdAt: d("2026-02-01"),
      },
      {
        id: "e",
        matchType: "contains" as const,
        matchPattern: "OPENAI",
        matchField: "name" as const,
        priority: 999,
        createdAt: d("2026-02-01"),
        isActive: false,
      },
    ];
    expect(orderRules(rules).map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
    expect(firstHit(orderRules(rules), text("OpenAI"))?.id).toBe("c");
    expect(firstHit(orderRules(rules.slice(0, 2)), text("OpenAI"))?.id).toBe("b");
    expect(firstHit(orderRules(rules), text("Netflix"))).toBeNull();
  });
});
