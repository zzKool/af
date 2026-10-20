import { describe, expect, it } from "vitest";
import { detectAccountFromFilename, pickAccount } from "./account-detect";

const accounts = [
  { id: "sek", accountNumber: "123 45 67-8", currency: "SEK" },
  { id: "chf", accountNumber: "123 45 67-8", currency: "CHF" },
  { id: "sav", accountNumber: "1234 56 78901", currency: "SEK" },
];

describe("account detection from the Nordea filename (R53)", () => {
  it("reads the Plusgiro number and kind", () => {
    const h = detectAccountFromFilename("PLUSGIROKONTO FTG 123 45 67-8 - 2026-07-31 09.12.01.csv");
    expect(h).toEqual({ accountNumber: "123 45 67-8", kind: "plusgiro" });
  });

  it("reads the Sparkonto number (with the folder stripped)", () => {
    const h = detectAccountFromFilename(
      "C:\\exports\\SPARKONTO FÖRETAG 1234 56 78901 - 2026-12-31 10.00.00.csv",
    );
    expect(h).toEqual({ accountNumber: "1234 56 78901", kind: "savings" });
  });

  it("gives no hint for an unknown filename", () => {
    expect(detectAccountFromFilename("export.csv")).toEqual({ accountNumber: null, kind: null });
  });

  it("the first row's currency picks between the two main accounts", () => {
    const hint = detectAccountFromFilename("PLUSGIROKONTO FTG 123 45 67-8 - x.csv");
    expect(pickAccount(accounts, hint, "CHF")?.id).toBe("chf");
    expect(pickAccount(accounts, hint, "SEK")?.id).toBe("sek");
    expect(pickAccount(accounts, hint, null)).toBeNull();
    expect(
      pickAccount(accounts, detectAccountFromFilename("SPARKONTO 1234 56 78901.csv"), null)?.id,
    ).toBe("sav");
    expect(pickAccount(accounts, { accountNumber: "999", kind: null }, "SEK")).toBeNull();
  });
});
