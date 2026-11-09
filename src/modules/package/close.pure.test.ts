// The Close page's month card (F155) — pure: the five checks are counted from the collected period, never typed;
// the zip tree lists what a build would write.
import { describe, expect, it } from "vitest";
import { closeMonth, ratesCoveredTo, ratesTarget } from "./close";
import { parsePeriod } from "./period";
import type { BankSheetRow, PackageDocument, PackageFlag, PeriodData } from "./types";

const bank = (id: string, account: string, flags: string[] = []): BankSheetRow =>
  ({
    id,
    account,
    accountRole: "main",
    bookingDate: "2026-07-10",
    amount: "-100.00",
    currency: "CHF",
    flags,
  }) as BankSheetRow;

const doc = (
  id: string,
  folder: PackageDocument["folder"],
  fileSize = 200_000,
): PackageDocument => ({
  id,
  folder,
  fileName: `${id}.pdf`,
  businessKey: id,
  mimeType: "application/pdf",
  fileSize,
});

const flag = (kind: PackageFlag["kind"], id: string): PackageFlag => ({
  kind,
  entity: "bank_transaction",
  id,
  key: id,
  detail: "",
});

const period = (over: Partial<PeriodData>): PeriodData => ({
  period: parsePeriod("2026-07"),
  bank: [],
  income: [],
  suppliers: [],
  expenses: [],
  settlements: [],
  links: [],
  flags: [],
  transfers: [],
  liability: [],
  vatPeriods: [],
  documents: [],
  collectedAt: "2026-08-05T10:00:00Z",
  ...over,
});

const check = (m: ReturnType<typeof closeMonth>, key: string) =>
  m.checks.find((c) => c.key === key);

describe("closeMonth", () => {
  it("an empty month: no bank line is the one open check besides the rates", () => {
    const m = closeMonth(period({}), { coveredTo: "2026-07-31", today: "2026-08-05" });
    expect(check(m, "bank")?.open).toBe(1);
    expect(check(m, "justified")?.open).toBe(0);
    expect(check(m, "documents")?.open).toBe(0);
    expect(check(m, "rates")?.open).toBe(0);
    expect(m.files).toBe(2); // summary.xlsx + notes.md
    expect(m.zip.map((e) => e.name)).toEqual(["summary.xlsx", "notes.md"]);
  });

  it("counts the unjustified lines, the documents' flags and the open invoices", () => {
    const m = closeMonth(
      period({
        bank: [
          bank("a", "Konto A"),
          bank("b", "Konto A", ["unlinked"]),
          bank("c", "Konto B", ["mixed"]), // a cell, not a flag: still justified
          bank("d", "Konto B", ["delta"]),
        ],
        documents: [doc("x", "client-invoices"), doc("y", "expenses"), doc("z", "expenses")],
        flags: [
          flag("unlinked_row", "b"),
          flag("delta", "d"),
          flag("missing_document", "e1"),
          flag("document_not_ready", "e2"),
          flag("unpaid_invoice", "i1"),
        ],
      }),
      { coveredTo: "2026-07-31", today: "2026-08-05" },
    );
    expect(check(m, "bank")).toMatchObject({ open: 0, total: 2, lines: 4 });
    expect(check(m, "justified")).toMatchObject({ open: 2, total: 4 });
    expect(check(m, "documents")).toMatchObject({ open: 2, total: 3 });
    expect(check(m, "invoices")?.open).toBe(1);
    expect(m.flags).toBe(5);
    expect(m.zip.map((e) => e.name)).toEqual([
      "bank-statements/",
      "client-invoices/",
      "expenses/",
      "summary.xlsx",
      "notes.md",
    ]);
    expect(m.zip.find((e) => e.kind === "expenses")?.files).toBe(2);
    expect(m.files).toBe(2 + 3 + 2); // two statements, three documents, the two generated files
    expect(m.bytes).toBe(600_000);
  });

  it("the rates check: open when the ECB stops more than three days short of the month's last weekday", () => {
    const at = (coveredTo: string | null) =>
      check(closeMonth(period({}), { coveredTo, today: "2026-08-20" }), "rates")?.open;
    expect(at("2026-07-31")).toBe(0);
    expect(at("2026-07-28")).toBe(0); // a TARGET closing day tolerated
    expect(at("2026-07-27")).toBe(1);
    expect(at(null)).toBe(1);
  });
});

describe("ratesTarget", () => {
  it("the month's last weekday, or two days back while the month runs", () => {
    expect(ratesTarget("2026-05-31", "2026-06-10")).toBe("2026-05-29"); // Sunday → Friday
    expect(ratesTarget("2026-07-31", "2026-07-15")).toBe("2026-07-13");
    expect(ratesTarget("2026-07-31", "2026-07-14")).toBe("2026-07-10"); // Sunday the 12th → Friday
  });
});

describe("ratesCoveredTo", () => {
  it("the oldest pair's newest day; null when a pair has none", () => {
    expect(ratesCoveredTo([{ latestDate: "2026-07-31" }, { latestDate: "2026-07-30" }])).toBe(
      "2026-07-30",
    );
    expect(ratesCoveredTo([{ latestDate: "2026-07-31" }, { latestDate: null }])).toBeNull();
    expect(ratesCoveredTo([])).toBeNull();
  });
});
