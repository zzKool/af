import { describe, expect, it } from "vitest";
import { checkBilledTo } from "./billed-to";

const company = {
  name: "Dev AB",
  orgNumber: "556677-8899",
  vatNumbers: ["SE556677889901", "CHE-123.456.789 TVA"],
};

describe("checkBilledTo", () => {
  it.each([
    [{ customerName: "Dev AB" }, "match"],
    [{ customerName: "DEV AB, Stockholm" }, "match"],
    [{ customerName: "Dév AB" }, "match"],
    [{ customerTaxId: "SE 5566 7788 9901" }, "match"],
    [{ customerTaxId: "CHE-123.456.789 TVA" }, "match"],
    // the organisation number inside a VAT number the profile does not list
    [{ customerTaxId: "SE556677889902" }, "match"],
    [{ customerName: "Jane Private", customerTaxId: "" }, "mismatch"],
    [{ customerName: "Other Company GmbH", customerTaxId: "DE123456789" }, "mismatch"],
    [{}, "unknown"],
    [{ customerName: "  ", customerTaxId: null }, "unknown"],
  ])("%j → %s", (billed, expected) => {
    expect(checkBilledTo(company, billed)).toBe(expected);
  });

  it("a short org number never matches by accident", () => {
    expect(checkBilledTo({ ...company, orgNumber: "12" }, { customerTaxId: "XX1234567" })).toBe(
      "mismatch",
    );
  });
});
