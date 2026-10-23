import { describe, expect, it } from "vitest";
import { toTransactionDetailWire } from "./detail-wire";
import type { TransactionDetail } from "./queries";

describe("toTransactionDetailWire (audit 29)", () => {
  it("turns every timestamp into its ISO string and keeps the rest", () => {
    const created = new Date("2026-10-23T08:15:00.000Z");
    const updated = new Date("2026-10-23T09:00:00.000Z");
    const imported = new Date("2026-10-22T18:30:00.000Z");
    const detail = {
      transaction: { id: "bt-1", bookingDate: "2026-10-01", amount: "-12.50", createdAt: created },
      accountLabel: "Nordea CHF",
      entry: { id: "je-1", amountBase: "-118.40", createdAt: created, updatedAt: updated },
      state: "justified",
      allocated: "12.50",
      links: [{ id: "l-1", kind: "justifies", createdAt: created, otherLabel: "Receipt" }],
      transfers: [],
      import: { id: "imp-1", fileName: "chf.csv", importedAt: imported },
    } as unknown as TransactionDetail;

    const wire = toTransactionDetailWire(detail);

    expect(wire.transaction.createdAt).toBe("2026-10-23T08:15:00.000Z");
    expect(wire.entry?.createdAt).toBe("2026-10-23T08:15:00.000Z");
    expect(wire.entry?.updatedAt).toBe("2026-10-23T09:00:00.000Z");
    expect(wire.links[0]?.createdAt).toBe("2026-10-23T08:15:00.000Z");
    expect(wire.import?.importedAt).toBe("2026-10-22T18:30:00.000Z");
    expect(wire.transaction.amount).toBe("-12.50");
    expect(wire.entry?.amountBase).toBe("-118.40");
    expect(wire.accountLabel).toBe("Nordea CHF");
    expect(wire.state).toBe("justified");
    expect(wire.allocated).toBe("12.50");
    expect(wire.links[0]?.otherLabel).toBe("Receipt");
  });

  it("keeps a row with no journal entry and no import as nulls", () => {
    const at = new Date("2026-10-20T12:00:00.000Z");
    const detail = {
      transaction: { createdAt: at },
      entry: null,
      links: [],
      transfers: [],
      import: null,
    } as unknown as TransactionDetail;
    const wire = toTransactionDetailWire(detail);
    expect(wire.entry).toBeNull();
    expect(wire.import).toBeNull();
    expect(wire.links).toEqual([]);
  });
});
