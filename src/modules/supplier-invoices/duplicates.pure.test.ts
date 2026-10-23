import { describe, expect, it } from "vitest";
import cases from "../../../specs/documents/fixtures/duplicate-check-cases.json";
import {
  evaluateSupplierInvoiceDuplicates,
  normaliseInvoiceNumber,
  type SupplierInvoiceCandidate,
} from "./duplicates";

type Existing = {
  id: string;
  partnerId: string;
  partnerName: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: string;
  currency: string;
  documentHash: string;
};
type Case = {
  case: string;
  entityType: string;
  partnerId?: string;
  invoiceNumber?: string;
  amount?: number;
  currency?: string;
  date?: string;
  documentHash: string;
  expectV1: { confidence: string; existingEntityId: string; type: string }[];
  expectV3?: { confidence: string; existingEntityId: string; type: string }[];
};
type Fixture = { entityScenarios: { existingSupplierInvoices: Existing[]; cases: Case[] } };

const { entityScenarios } = cases as unknown as Fixture;
const candidates: SupplierInvoiceCandidate[] = entityScenarios.existingSupplierInvoices.map(
  (e) => ({
    id: e.id,
    key: `SI26-${e.id}`,
    partnerId: e.partnerId,
    invoiceNumber: e.invoiceNumber,
    invoiceDate: e.invoiceDate,
    amountTotal: e.totalAmount,
    currency: e.currency,
  }),
);
const names = new Map(
  entityScenarios.existingSupplierInvoices.map((e) => [e.partnerId, e.partnerName]),
);
const TYPE = { EXACT_MATCH: "exact", CONTENT_HASH: "hash", FUZZY_MATCH: "fuzzy" } as const;

describe("supplier-invoice duplicates (harvest §4.2, specs/documents US3)", () => {
  it("normalises the number: trim, collapse spaces, case-fold", () => {
    expect(normaliseInvoiceNumber(" F-2026-0042 ")).toBe("f-2026-0042");
    expect(normaliseInvoiceNumber("9160  A")).toBe("9160 a");
  });

  for (const c of entityScenarios.cases.filter((c) => c.entityType === "SUPPLIER_INVOICE")) {
    it(c.case, () => {
      // the hash strategy's input: the entities the same bytes already became
      const twins = entityScenarios.existingSupplierInvoices
        .filter((e) => e.documentHash === c.documentHash)
        .map((e) => e.id);
      const got = evaluateSupplierInvoiceDuplicates(
        {
          partnerId: c.partnerId,
          invoiceNumber: c.invoiceNumber,
          amount: c.amount != null ? String(c.amount) : undefined,
          currency: c.currency,
          date: c.date,
        },
        candidates,
        twins,
        names,
      );
      const expected = (c.expectV3 ?? c.expectV1).map((e) => ({
        entityId: e.existingEntityId,
        kind: (TYPE as Record<string, string>)[e.type] ?? e.type,
        confidence: e.confidence.toLowerCase(),
      }));
      expect(
        got.map((m) => ({ entityId: m.entityId, kind: m.kind, confidence: m.confidence })),
      ).toEqual(expected);
    });
  }

  it("reports each entity once, high first, with the partner's name in the reason", () => {
    const got = evaluateSupplierInvoiceDuplicates(
      {
        partnerId: "p-nordea",
        invoiceNumber: "F-2026-0042",
        amount: "1000",
        currency: "SEK",
        date: "2026-03-10",
      },
      candidates,
      ["si-1"],
      names,
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: "exact", confidence: "high", partnerName: "Nordea" });
    expect(got[0].reason.params).toEqual({ n: "F-2026-0042", partner: "Nordea" });
  });

  it("a cancelled invoice still holds its number (D35): exact sees it, hash and fuzzy do not", () => {
    const cancelled: SupplierInvoiceCandidate = {
      id: "si-x",
      key: "SI26-si-x",
      partnerId: "p-nordea",
      invoiceNumber: "F-2026-0099",
      invoiceDate: "2026-03-10",
      amountTotal: "500.00",
      currency: "SEK",
      cancelled: true,
    };
    const exact = evaluateSupplierInvoiceDuplicates(
      { partnerId: "p-nordea", invoiceNumber: " f-2026-0099" },
      [cancelled],
      [],
      names,
    );
    expect(exact.map((m) => [m.kind, m.entityId])).toEqual([["exact", "si-x"]]);
    const others = evaluateSupplierInvoiceDuplicates(
      {
        partnerId: "p-nordea",
        invoiceNumber: "F-2026-0100",
        amount: "500",
        currency: "SEK",
        date: "2026-03-10",
      },
      [cancelled],
      ["si-x"],
      names,
    );
    expect(others).toEqual([]);
  });
});
