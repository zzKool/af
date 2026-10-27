import { describe, expect, it } from "vitest";
import { CONFIDENCE_FAMILY, confidenceFamily } from "./confidence-family";
import { splitLabelKey } from "./label-key";

describe("splitLabelKey", () => {
  it("takes the head of a keyed type's label as its key", () => {
    expect(splitLabelKey("invoice", "VA26-INV-001 · Vaudoise · 1000.00 CHF")).toEqual({
      key: "VA26-INV-001",
      rest: "Vaudoise · 1000.00 CHF",
    });
    expect(splitLabelKey("supplier_invoice", "SI-2026-031")).toEqual({
      key: "SI-2026-031",
      rest: "",
    });
  });

  it("leaves unkeyed types whole — a bank row leads with its date, a partner is a name", () => {
    const row = "2026-10-01 · 1000.00 SEK · VA26-INV-001 · SEK main";
    expect(splitLabelKey("bank_transaction", row)).toEqual({ key: null, rest: row });
    expect(splitLabelKey("partner", "Vaudoise · Lausanne")).toEqual({
      key: null,
      rest: "Vaudoise · Lausanne",
    });
  });

  it("an empty label has no key", () => {
    expect(splitLabelKey("invoice", "")).toEqual({ key: null, rest: "" });
  });
});

describe("confidence → state family", () => {
  it("maps every confidence, HIGH as done", () => {
    expect(confidenceFamily("HIGH")).toBe("done");
    expect(confidenceFamily("MEDIUM")).toBe("progress");
    expect(confidenceFamily("LOW")).toBe("neutral");
    expect(Object.keys(CONFIDENCE_FAMILY).sort()).toEqual(["HIGH", "LOW", "MEDIUM"]);
  });
});
