// FR-003 / SC-004: the partner's default category is proposed, never overwriting the owner's choice.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CategoryState,
  chooseCategory,
  proposeCategory,
  proposeFromAi,
} from "./category-proposal";

const CODES = ["580", "583", "653", "690"];
const start: CategoryState = { code: "580", source: null };

describe("proposeCategory", () => {
  it("US1-1: no category chosen → the partner's default, marked from partner", () => {
    expect(proposeCategory(start, "583", CODES)).toEqual({ code: "583", source: "partner" });
  });

  it("US1-2: the owner chose a category → a partner with another default leaves it", () => {
    const chosen = chooseCategory("690");
    expect(proposeCategory(chosen, "583", CODES)).toEqual({ code: "690", source: "owner" });
  });

  it("US1-3: from A's default, switching to B → B's default; clearing the partner keeps it", () => {
    const fromA = proposeCategory(start, "583", CODES);
    const fromB = proposeCategory(fromA, "653", CODES);
    expect(fromB).toEqual({ code: "653", source: "partner" });
    expect(proposeCategory(fromB, null, CODES)).toEqual({ code: "653", source: "partner" });
  });

  it("US1-4: a partner without a default leaves the category untouched", () => {
    expect(proposeCategory(start, null, CODES)).toBe(start);
    const fromA = proposeCategory(start, "583", CODES);
    expect(proposeCategory(fromA, undefined, CODES)).toBe(fromA);
  });

  it("a default that is not one of the tenant's categories is not proposed", () => {
    expect(proposeCategory(start, "999", CODES)).toBe(start);
  });

  it("SC-004: across any sequence of picks, clears and choices, an owner-chosen code is never replaced", () => {
    const step = fc.oneof(
      fc.record({
        op: fc.constant("pick" as const),
        def: fc.option(fc.constantFrom(...CODES, "999")),
      }),
      fc.record({ op: fc.constant("clear" as const) }),
      fc.record({ op: fc.constant("choose" as const), code: fc.constantFrom(...CODES) }),
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        let state = start;
        let owned: string | null = null;
        for (const s of steps) {
          if (s.op === "choose") {
            state = chooseCategory(s.code);
            owned = s.code;
          } else {
            state = proposeCategory(state, s.op === "pick" ? s.def : null, CODES);
          }
          if (owned !== null) expect(state).toEqual({ code: owned, source: "owner" });
          expect(CODES).toContain(state.code);
        }
      }),
    );
  });
});

describe("proposeFromAi (F126)", () => {
  const codes = ["501", "654", "659"];
  it("fills an empty, untouched field only, with a code the tenant has", () => {
    expect(proposeFromAi({ code: "", source: null }, "659", codes)).toEqual({
      code: "659",
      source: "ai",
    });
    expect(proposeFromAi({ code: "", source: null }, "999", codes)).toEqual({
      code: "",
      source: null,
    });
    expect(proposeFromAi({ code: "654", source: "owner" }, "659", codes)).toEqual({
      code: "654",
      source: "owner",
    });
    expect(proposeFromAi({ code: "654", source: "partner" }, "659", codes)).toEqual({
      code: "654",
      source: "partner",
    });
  });

  it("a partner picked afterwards replaces it with its default; the owner's pick is his", () => {
    const ai = proposeFromAi({ code: "", source: null }, "659", codes);
    expect(proposeCategory(ai, "654", codes)).toEqual({ code: "654", source: "partner" });
    expect(chooseCategory("501")).toEqual({ code: "501", source: "owner" });
  });
});
