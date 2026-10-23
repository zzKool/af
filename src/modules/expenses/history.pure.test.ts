import { describe, expect, it } from "vitest";
import { changedFields, expenseHistory } from "./history";

const base = {
  date: "2025-03-10T00:00:00.000Z",
  description: "Hotel",
  basCode: "5831",
  currency: "SEK",
  paymentSourceId: "src-1",
  documentMissing: false,
  note: null,
  updatedAt: "2025-03-10T10:00:00.000Z",
};

describe("expense history", () => {
  it("names the fields an update changed, not the bookkeeping columns", () => {
    const after = { ...base, note: "Booked online", updatedAt: "2025-03-11T10:00:00.000Z" };
    expect(changedFields(base, after)).toEqual(["note"]);
  });

  it("a field present on one side only counts as changed; absent on both does not", () => {
    expect(changedFields({ ...base }, { ...base, vatAmount: "12.00" })).toEqual(["vatAmount"]);
    expect(changedFields(base, base)).toEqual([]);
  });

  it("keeps the HISTORY_FIELDS order whatever the JSON key order", () => {
    const { note: _n, description: _d, ...rest } = base;
    const after = { note: "x", description: "Hotel Bern", ...rest };
    expect(changedFields(base, after)).toEqual(["description", "note"]);
  });

  it("newest first; a create lists no fields; unknown actions are left out", () => {
    const h = expenseHistory([
      {
        id: "a",
        action: "create",
        oldData: null,
        newData: base,
        createdAt: "2025-03-10T10:00:00Z",
      },
      {
        id: "b",
        action: "update",
        oldData: base,
        newData: { ...base, basCode: "5800" },
        createdAt: new Date("2025-03-12T08:00:00Z"),
      },
      {
        id: "c",
        action: "reactivate",
        oldData: null,
        newData: null,
        createdAt: "2025-03-13T00:00:00Z",
      },
    ]);
    expect(h).toEqual([
      { id: "b", action: "update", at: "2025-03-12T08:00:00.000Z", fields: ["basCode"] },
      { id: "a", action: "create", at: "2025-03-10T10:00:00.000Z", fields: [] },
    ]);
  });

  it("survives a non-object snapshot (the JSON null of an old row)", () => {
    expect(changedFields(null, { ...base })).toEqual([
      "date",
      "description",
      "basCode",
      "currency",
      "paymentSourceId",
      "documentMissing",
      "note",
    ]);
  });
});
