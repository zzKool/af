import { describe, expect, it } from "vitest";
import { CONFIDENCE_FAMILY, confidenceFamily } from "./confidence-family";
import { splitLabelKey } from "./label-key";

describe("splitLabelKey", () => {
  it("takes the head of a keyed type's label as its key", () => {
    expect(splitLabelKey("invoice", "LK26-INV-001 · Lakeside · 1000.00 CHF")).toEqual({
      key: "LK26-INV-001",
      rest: "Lakeside · 1000.00 CHF",
    });
    expect(splitLabelKey("supplier_invoice", "SI-2026-031")).toEqual({
      key: "SI-2026-031",
      rest: "",
    });
  });

  it("leaves unkeyed types whole — a bank row leads with its date, a partner is a name", () => {
    const row = "2026-10-01 · 1000.00 SEK · LK26-INV-001 · SEK main";
    expect(splitLabelKey("bank_transaction", row)).toEqual({ key: null, rest: row });
    expect(splitLabelKey("partner", "Lakeside · Lausanne")).toEqual({
      key: null,
      rest: "Lakeside · Lausanne",
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
