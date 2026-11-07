import { describe, expect, it } from "vitest";
import { missingSteps, type RowStepFacts, rowSteps, rowVerdict } from "./steps";

const row = (f: Partial<RowStepFacts>): RowStepFacts => ({
  state: "open",
  partnerId: null,
  basCode: null,
  ...f,
});

describe("rowSteps — proof · partner · category from what the row carries (D76)", () => {
  it("an open row with nothing: three missing", () => {
    const s = rowSteps(row({}));
    expect(s).toEqual({ proof: "missing", partner: "missing", category: "missing" });
    expect(missingSteps(s)).toBe(3);
    expect(rowVerdict(s)).toBe("missing");
  });

  it("linked, with a partner and a category: done", () => {
    const s = rowSteps(row({ state: "linked", partnerId: "p", basCode: "6540" }));
    expect(s).toEqual({ proof: "done", partner: "done", category: "done" });
    expect(rowVerdict(s)).toBe("done");
  });

  it("linked without a partner (D73): the proof is done, the partner is what is missing", () => {
    const s = rowSteps(row({ state: "linked_no_partner", basCode: "6540" }));
    expect(s).toEqual({ proof: "done", partner: "missing", category: "done" });
    expect(missingSteps(s)).toBe(1);
  });

  it("partial: the proof counts as still to do", () => {
    const s = rowSteps(row({ state: "partial", partnerId: "p", basCode: "6540" }));
    expect(s.proof).toBe("partial");
    expect(missingSteps(s)).toBe(1);
  });

  it("a proposal is proposed, not missing — the verdict asks for a check", () => {
    const s = rowSteps(
      row({ state: "linked", partnerId: "p", proposedBasCode: "6540", proposedPartner: true }),
    );
    expect(s.category).toBe("proposed");
    expect(missingSteps(s)).toBe(0);
    expect(rowVerdict(s)).toBe("proposed");
    expect(rowSteps(row({ proposedPartner: true })).partner).toBe("proposed");
  });

  it("no proof needed with a partner (a fee): the proof is not needed", () => {
    const s = rowSteps(row({ state: "no_document", partnerId: "bank", basCode: "6570" }));
    expect(s).toEqual({ proof: "none", partner: "done", category: "done" });
    expect(rowVerdict(s)).toBe("no_proof");
  });

  it("a transfer leg (no_document, no partner, no category): nothing needed at all", () => {
    const s = rowSteps(row({ state: "no_document" }));
    expect(s).toEqual({ proof: "none", partner: "none", category: "none" });
    expect(rowVerdict(s)).toBe("no_proof");
  });

  it("flagged without a partner: the partner is missing", () => {
    const s = rowSteps(row({ state: "no_document_no_partner", basCode: "6570" }));
    expect(s).toEqual({ proof: "none", partner: "missing", category: "done" });
    expect(rowVerdict(s)).toBe("missing");
  });
});
