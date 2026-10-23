// F71: the panel's History names each audit entry by what the service wrote (history.ts) — fixtures are the shapes
// create / update / lifecycle / payments write today.
import { describe, expect, it } from "vitest";
import { historyEvent } from "./history";

const update = (oldData: unknown, newData: unknown) => ({ action: "update", oldData, newData });

describe("supplier invoice history", () => {
  it("create and delete are what they say", () => {
    expect(historyEvent({ action: "create", oldData: null, newData: { key: "SI1" } })).toBe(
      "created",
    );
    expect(historyEvent({ action: "delete", oldData: { key: "SI1" }, newData: null })).toBe(
      "deleted",
    );
  });

  it("cancel and reinstate (lifecycle.ts)", () => {
    expect(
      historyEvent(update({ cancelled: false }, { cancelled: true, cancelledReason: "Twice" })),
    ).toBe("cancelled");
    expect(
      historyEvent(update({ cancelled: true, cancelledReason: "Twice" }, { cancelled: false })),
    ).toBe("reinstated");
  });

  it("a same-currency payment, a cross-currency attach and its detach (payments.ts)", () => {
    expect(
      historyEvent(
        update(null, { payment: { bankTransactionId: "b", amount: "100.00", currency: "SEK" } }),
      ),
    ).toBe("paymentLinked");
    expect(
      historyEvent(
        update(
          { amountBase: "1000.00", rateSource: "ecb_daily", paidAmount: null },
          {
            bankTransactionId: "b",
            paidAmount: "1100.00",
            paidCurrency: "SEK",
            rateSource: "bank",
          },
        ),
      ),
    ).toBe("rowAttached");
    expect(
      historyEvent(
        update(
          { paidAmount: "1100.00", paidCurrency: "SEK" },
          { paidAmount: null, amountBase: "1000.00", rateSource: "ecb_daily" },
        ),
      ),
    ).toBe("rowDetached");
  });

  it("any other update is an edit — a full row before and after, even on a cancelled invoice", () => {
    const row = { key: "SI1", cancelled: false, paidAmount: null, note: null };
    expect(historyEvent(update(row, { ...row, note: "July fee" }))).toBe("edited");
    const cancelled = { ...row, cancelled: true };
    expect(historyEvent(update(cancelled, { ...cancelled, note: "x" }))).toBe("edited");
    expect(historyEvent(update(null, null))).toBe("edited");
  });
});
