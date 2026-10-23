// The derived state of a bank row (spec US4 / US5, F65): pinned on the tolerance edge and, as a property, equal to the
// rule written out by hand — `linked` when Σ ≥ |amount| − max(0.05, 0.5 % of |amount|) — now that it reads the
// kernel's `isSettled` (lessons audit 27).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import "./months"; // loads the module graph in the order the app does (queries alone starts a cycle)
import { deriveTransactionState } from "./queries";

const D = Prisma.Decimal;
const state = (
  amount: string,
  allocated: string,
  extra: Partial<{ t: boolean; n: boolean }> = {},
) =>
  deriveTransactionState({
    amount,
    allocated,
    inTransfer: extra.t ?? false,
    noDocumentNeeded: extra.n ?? false,
  });

/** cents → "12.34" */
const money = (cents: number) => new D(cents).div(100).toFixed(2);

describe("deriveTransactionState", () => {
  it("open, partial, linked on the tolerance edge; the flag and a transfer leg are no document", () => {
    expect(state("-1000.00", "0.00")).toBe("open");
    expect(state("-1000.00", "994.99")).toBe("partial"); // tolerance 5.00
    expect(state("-1000.00", "995.00")).toBe("linked");
    expect(state("-1.00", "0.95")).toBe("linked"); // the 0.05 floor
    expect(state("-1.00", "0.94")).toBe("partial");
    expect(state("250.00", "250.00")).toBe("linked"); // an incoming row reads |amount| too
    expect(state("-1000.00", "0.00", { n: true })).toBe("no_document");
    expect(state("-1000.00", "400.00", { t: true })).toBe("no_document");
  });

  it("property: the state equals the rule written out by hand", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000_000, max: 100_000_000 }).filter((c) => c !== 0),
        fc.integer({ min: 0, max: 110_000_000 }),
        (amountCents, allocatedCents) => {
          const amount = money(amountCents);
          const allocated = money(allocatedCents);
          const abs = new D(amount).abs();
          const tolerance = D.max(
            new D("0.05"),
            abs.mul("0.005").toDecimalPlaces(2, D.ROUND_HALF_UP),
          );
          const expected = new D(allocated).lte(0)
            ? "open"
            : new D(allocated).gte(abs.minus(tolerance))
              ? "linked"
              : "partial";
          expect(state(amount, allocated)).toBe(expected);
        },
      ),
    );
  });
});
