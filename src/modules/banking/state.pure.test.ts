// The derived state of a bank row (spec US4 / US5, F65; F129 US2: a justified row names a partner, D73): pinned on
// the tolerance edge, on the partner and on the account role, and — as a property — equal to the rule of
// specs/justify/rework.md §The target written out by hand, for every combination of flag, transfer, allocation,
// partner and account role. The tolerance is the kernel's `isSettled` (lessons audit 27).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import "./months"; // loads the module graph in the order the app does (queries alone starts a cycle)
import { needsProof } from "./months";
import { deriveTransactionState } from "./queries";
import type { BankAccountRole, TransactionState } from "./types";

const D = Prisma.Decimal;
const PARTNER = "11111111-1111-4111-8111-111111111111";
const state = (
  amount: string,
  allocated: string,
  extra: Partial<{ t: boolean; n: boolean; p: boolean; role: BankAccountRole }> = {},
) =>
  deriveTransactionState({
    amount,
    allocated,
    inTransfer: extra.t ?? false,
    noDocumentNeeded: extra.n ?? false,
    partnerId: extra.p ? PARTNER : null,
    accountRole: extra.role ?? "main",
  });

/** cents → "12.34" */
const money = (cents: number) => new D(cents).div(100).toFixed(2);

describe("deriveTransactionState", () => {
  it("open, partial, linked on the tolerance edge — linked only with a partner", () => {
    expect(state("-1000.00", "0.00")).toBe("open");
    expect(state("-1000.00", "994.99", { p: true })).toBe("partial"); // tolerance 5.00
    expect(state("-1000.00", "995.00", { p: true })).toBe("linked");
    expect(state("-1000.00", "995.00")).toBe("linked_no_partner"); // example 9: a document proof, no partner
    expect(state("-1.00", "0.95", { p: true })).toBe("linked"); // the 0.05 floor
    expect(state("-1.00", "0.94", { p: true })).toBe("partial");
    expect(state("250.00", "250.00", { p: true })).toBe("linked"); // an incoming row reads |amount| too
  });

  it("the flag is no document with a partner (examples 3, 5, 6), no proof · no partner without one (example 4)", () => {
    expect(state("-139.00", "0.00", { n: true, p: true })).toBe("no_document");
    expect(state("-139.00", "0.00", { n: true })).toBe("no_document_no_partner");
    // the flag wins over an allocation either way
    expect(state("-1000.00", "400.00", { n: true, p: true })).toBe("no_document");
    expect(state("-1000.00", "400.00", { n: true })).toBe("no_document_no_partner");
  });

  it("a transfer leg (example 10) and a savings-account row (example 11, Q3) need no partner", () => {
    expect(state("-1000.00", "400.00", { t: true })).toBe("no_document");
    expect(state("-20000.00", "0.00", { t: true, p: true })).toBe("no_document");
    expect(state("12.40", "0.00", { n: true, role: "savings" })).toBe("no_document");
    expect(state("12.40", "12.40", { role: "savings" })).toBe("linked");
    expect(state("12.40", "0.00", { role: "savings" })).toBe("open");
  });

  it("the four states to justify are exactly the ones a partner or a proof is missing from", () => {
    const toJustify: TransactionState[] = [
      "open",
      "partial",
      "linked_no_partner",
      "no_document_no_partner",
    ];
    for (const s of [
      "open",
      "partial",
      "linked",
      "linked_no_partner",
      "no_document",
      "no_document_no_partner",
    ] as const)
      expect(needsProof(s), s).toBe(toJustify.includes(s));
  });

  it("property: the state equals the rule of §The target written out by hand", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000_000, max: 100_000_000 }).filter((c) => c !== 0),
        fc.integer({ min: 0, max: 110_000_000 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<BankAccountRole>("main", "savings", "owner_private"),
        (amountCents, allocatedCents, flag, transfer, partner, role) => {
          const amount = money(amountCents);
          const allocated = money(allocatedCents);
          const abs = new D(amount).abs();
          const tolerance = D.max(
            new D("0.05"),
            abs.mul("0.005").toDecimalPlaces(2, D.ROUND_HALF_UP),
          );
          const named = partner || role === "savings";
          const expected: TransactionState = transfer
            ? "no_document"
            : flag
              ? named
                ? "no_document"
                : "no_document_no_partner"
              : new D(allocated).lte(0)
                ? "open"
                : new D(allocated).gte(abs.minus(tolerance))
                  ? named
                    ? "linked"
                    : "linked_no_partner"
                  : "partial";
          expect(state(amount, allocated, { t: transfer, n: flag, p: partner, role })).toBe(
            expected,
          );
        },
      ),
    );
  });
});
