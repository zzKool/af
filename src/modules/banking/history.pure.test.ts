// The History mapping (F71): which audit rows become which events, a link's other end, newest first.
import { describe, expect, it } from "vitest";
import { type AuditRow, toHistoryEvents } from "./history";

const SELF = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const at = (minute: number) => new Date(Date.UTC(2026, 9, 23, 10, minute));
const row = (r: Partial<AuditRow> & Pick<AuditRow, "entityType" | "action">): AuditRow => ({
  entityId: SELF,
  source: "web",
  oldData: null,
  newData: null,
  createdAt: at(0),
  ...r,
});
const entry = (fields: Record<string, unknown>) => ({
  basCode: null,
  partnerId: null,
  noDocumentNeeded: false,
  categorisedBy: null,
  ...fields,
});

describe("toHistoryEvents", () => {
  it("the bank row's create is the import; the journal entry's create and an unchanged update say nothing", () => {
    const events = toHistoryEvents(
      [
        row({ entityType: "bank_transaction", action: "create", source: "web" }),
        row({ entityType: "journal_entry", action: "create", newData: entry({}) }),
        row({
          entityType: "journal_entry",
          action: "update",
          oldData: entry({ bankImplicitRate: null }),
          newData: entry({ bankImplicitRate: "11.9" }),
        }),
      ],
      SELF,
    );
    expect(events).toEqual([{ kind: "imported", at: at(0).toISOString(), source: "web" }]);
  });

  it("a journal update gives one event per fact the owner sees, with who decided it", () => {
    const events = toHistoryEvents(
      [
        row({
          entityType: "journal_entry",
          action: "update",
          oldData: entry({}),
          newData: entry({
            basCode: "657",
            partnerId: OTHER,
            noDocumentNeeded: true,
            categorisedBy: "rule",
          }),
        }),
      ],
      SELF,
    );
    expect(events.map((e) => e.kind)).toEqual(["categorised", "partner", "no_document"]);
    expect(events[0]).toMatchObject({ basCode: "657", by: "rule" });
  });

  it("a cleared category and a lifted no-document flag are events too", () => {
    const events = toHistoryEvents(
      [
        row({
          entityType: "journal_entry",
          action: "update",
          oldData: entry({ basCode: "657", noDocumentNeeded: true, categorisedBy: "rule" }),
          newData: entry({ categorisedBy: "manual" }),
        }),
      ],
      SELF,
    );
    expect(events).toMatchObject([
      { kind: "uncategorised", by: "manual" },
      { kind: "document_needed", by: "manual" },
    ]);
  });

  it("a link names the other end whichever side the row is on; an unknown kind is dropped", () => {
    const link = (
      fromId: string,
      fromType: string,
      toId: string,
      toType: string,
      kind = "justifies",
    ) =>
      row({
        entityType: "link",
        entityId: OTHER,
        action: "create",
        newData: { fromId, fromType, toId, toType, kind },
      });
    const events = toHistoryEvents(
      [
        link(SELF, "bank_transaction", OTHER, "supplier_invoice"),
        link(OTHER, "bank_transaction", SELF, "bank_transaction", "transfer"),
        link(SELF, "bank_transaction", OTHER, "invoice", "nonsense"),
      ],
      SELF,
    );
    expect(events).toMatchObject([
      { kind: "linked", linkKind: "justifies", otherType: "supplier_invoice" },
      { kind: "linked", linkKind: "transfer", otherType: "bank_transaction" },
    ]);
  });

  it("newest first across the trails; one moment keeps its order", () => {
    const events = toHistoryEvents(
      [
        row({ entityType: "bank_transaction", action: "create", createdAt: at(1) }),
        row({
          entityType: "journal_entry",
          action: "update",
          createdAt: at(5),
          oldData: entry({}),
          newData: entry({ basCode: "657", partnerId: OTHER, categorisedBy: "manual" }),
        }),
        row({
          entityType: "link",
          action: "create",
          createdAt: at(3),
          newData: {
            fromId: SELF,
            fromType: "bank_transaction",
            toId: OTHER,
            toType: "expense",
            kind: "justifies",
          },
        }),
      ],
      SELF,
    );
    expect(events.map((e) => e.kind)).toEqual(["categorised", "partner", "linked", "imported"]);
  });
});
