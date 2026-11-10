// The accept chain's pure half (F185): what the one click lacks, the steps and the button's word, the payloads it
// sends — the actions' own inputs. Invented values (D51).
import { describe, expect, it } from "vitest";
import {
  type AcceptChain,
  acceptLabelKey,
  acceptMissing,
  chainSteps,
  expensePayload,
  supplierPayload,
} from "./accept-chain-rules";

const chain = (over: Partial<AcceptChain> = {}): AcceptChain => ({
  documentId: "doc-1",
  kind: "supplier_invoice",
  key: "SI12-IT-03",
  vendor: "Lindgren Kontorsservice AB",
  group: { id: "g-1", number: 12, name: "July 2026", month: "2026-07", isNew: false },
  category: { code: "6540", label: "6540 · IT services (IT)", source: "partner" },
  partner: { id: "p-1", name: "Lindgren Kontorsservice AB", percent: 100 },
  bankRow: {
    id: "row-1",
    date: "2026-07-08",
    amount: "-1297.20",
    currency: "SEK",
    score: 98,
    label: "LINDGREN",
  },
  fields: {
    invoiceNumber: "30418",
    date: "2026-07-06",
    dueDate: "2026-08-05",
    currency: "SEK",
    amountTotal: "1297.20",
    vatAmount: "259.44",
    amountNet: "1037.76",
  },
  missing: [],
  ...over,
});

describe("acceptMissing", () => {
  it("nothing lacks on a full chain", () => {
    expect(acceptMissing(chain())).toEqual([]);
  });

  it("a supplier invoice needs its partner and its number; every kind a category, a group, the facts", () => {
    expect(
      acceptMissing(
        chain({
          partner: null,
          category: null,
          group: null,
          fields: {
            ...chain().fields,
            invoiceNumber: " ",
            currency: null,
            date: null,
            amountTotal: "0.00",
          },
        }),
      ),
    ).toEqual(["partner", "category", "group", "invoiceNumber", "amount", "date", "currency"]);
  });

  it("an expense needs no partner nor number, but its payer: without its bank row the form asks", () => {
    const e = chain({
      kind: "expense",
      partner: null,
      fields: { ...chain().fields, invoiceNumber: null },
    });
    expect(acceptMissing(e)).toEqual([]);
    expect(acceptMissing({ ...e, bankRow: null })).toEqual(["payer"]);
  });
});

describe("chainSteps / acceptLabelKey", () => {
  it("creates · links · files → Accept all three; no row → both; nothing to file → one", () => {
    expect(chainSteps(chain())).toEqual(["creates", "links", "files"]);
    expect(acceptLabelKey(chainSteps(chain()).length)).toBe("three");
    expect(chainSteps(chain({ bankRow: null }))).toEqual(["creates", "files"]);
    expect(acceptLabelKey(2)).toBe("both");
    expect(chainSteps(chain({ bankRow: null, category: null, partner: null }))).toEqual([
      "creates",
    ]);
    expect(acceptLabelKey(1)).toBe("one");
  });
});

describe("payloads", () => {
  it("the supplier invoice's fields as justifyRow / create take them", () => {
    expect(supplierPayload(chain(), "g-1")).toEqual({
      groupId: "g-1",
      partnerId: "p-1",
      invoiceNumber: "30418",
      invoiceDate: "2026-07-06",
      dueDate: "2026-08-05",
      currency: "SEK",
      amountNet: "1037.76",
      vatAmount: "259.44",
      amountTotal: "1297.20",
      basCode: "6540",
    });
  });

  it("the expense's: the vendor as its description, the partner when there is one", () => {
    expect(
      expensePayload(
        chain({ kind: "expense", partner: null, fields: { ...chain().fields, vatAmount: null } }),
        "g-2",
      ),
    ).toEqual({
      groupId: "g-2",
      date: "2026-07-06",
      description: "Lindgren Kontorsservice AB",
      basCode: "6540",
      amount: "1297.20",
      currency: "SEK",
      partnerId: null,
    });
  });
});
