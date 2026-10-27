import { describe, expect, it } from "vitest";
import { basName } from "./bas-name";

describe("basName — the words beside the BAS code tag (F71)", () => {
  it("drops the code prefix settings puts in front", () => {
    expect(basName("657", "657 · Bankkostnader")).toBe("Bankkostnader");
  });
  it("keeps a label without that prefix as it is", () => {
    expect(basName("657", "Bankkostnader")).toBe("Bankkostnader");
    expect(basName("657", "6570 · Other")).toBe("6570 · Other");
  });
  it("nothing to add when the label is the code, blank or the bare prefix", () => {
    expect(basName("657", "657")).toBeNull();
    expect(basName("657", null)).toBeNull();
    expect(basName("657", "657 · ")).toBeNull();
  });
});
