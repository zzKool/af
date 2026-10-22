import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { formatMoney, MINUS, THIN_SPACE } from "@/kernel/money/format-money";

const S = THIN_SPACE;
const NB = " ";

describe("formatMoney — the one on-screen format (D40)", () => {
  test.each([
    ["-2312.43", "SEK", `${MINUS}2${S}312.43${NB}SEK`],
    ["237740", "SEK", `237${S}740.00${NB}SEK`],
    ["24000.00", "CHF", `24${S}000.00${NB}CHF`],
    ["0.5", "EUR", `0.50${NB}EUR`],
    ["999", "USD", `999.00${NB}USD`],
    ["1000", "USD", `1${S}000.00${NB}USD`],
    ["-0.01", "SEK", `${MINUS}0.01${NB}SEK`],
    ["1234567.89", "SEK", `1${S}234${S}567.89${NB}SEK`],
  ])("%s %s → %s", (amount, currency, expected) => {
    expect(formatMoney(amount, currency)).toBe(expected);
  });

  test("the same in every currency — no apostrophe, no comma decimals (the v2 per-currency formats are gone)", () => {
    expect(formatMoney("12500", "CHF")).not.toContain("'");
    expect(formatMoney("12500", "SEK")).not.toContain(",");
  });

  test("signed: + only when asked, never on zero; zero is never negative", () => {
    expect(formatMoney("237740", "SEK", { signed: true })).toBe(`+237${S}740.00${NB}SEK`);
    expect(formatMoney("-5", "SEK", { signed: true })).toBe(`${MINUS}5.00${NB}SEK`);
    expect(formatMoney("0", "SEK", { signed: true })).toBe(`0.00${NB}SEK`);
    expect(formatMoney("-0.00", "SEK")).toBe(`0.00${NB}SEK`);
  });

  test("bare, or no currency: the number alone", () => {
    expect(formatMoney("1200", "CHF", { bare: true })).toBe(`1${S}200.00`);
    expect(formatMoney("1200", null)).toBe(`1${S}200.00`);
  });

  test("trailing zeros past the cents are accepted; real sub-cent precision is refused (round first)", () => {
    expect(formatMoney("12.500000", "SEK")).toBe(`12.50${NB}SEK`);
    expect(() => formatMoney("12.505", "SEK")).toThrow(/round before formatting/);
  });

  test("garbage is refused, never shown as a number", () => {
    for (const bad of ["", "abc", "1,5", "1e3", "--1", "NaN"]) {
      expect(() => formatMoney(bad, "SEK")).toThrow(TypeError);
    }
  });

  test("property: stripping the separators gives back the amount at 2 decimals", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e13, max: 1e13 }), (cents) => {
        const neg = cents < 0;
        const abs = Math.abs(cents);
        const amount = `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
        const shown = formatMoney(amount, "SEK", { bare: true });
        const back = shown.replaceAll(S, "").replace(MINUS, "-");
        const expected = cents === 0 ? "0.00" : amount;
        expect(back).toBe(expected);
        // groups of three digits, never more
        expect(
          shown
            .replace(MINUS, "")
            .split(".")[0]
            .split(S)
            .slice(1)
            .every((g) => g.length === 3),
        ).toBe(true);
      }),
    );
  });
});
