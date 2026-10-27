// The payment picker's search (F97 US2): a date prefix, an amount within ± 1 %, else the text. Invented rows.
import { describe, expect, it } from "vitest";
import { type PickableRow, searchRows } from "./components/payment-picker";

const rows: PickableRow[] = [
  {
    id: "a",
    bookingDate: "2026-07-08",
    amount: "-1297.20",
    currency: "SEK",
    description: "SKATTEPUNKTEN OFFICE",
    accountLabel: "Plusgirokonto SEK",
  },
  {
    id: "b",
    bookingDate: "2026-07-09",
    amount: "-1290.00",
    currency: "SEK",
    description: "OPENAI *CHATGPT",
    accountLabel: "Plusgirokonto SEK",
  },
  {
    id: "c",
    bookingDate: "2026-06-30",
    amount: "-45.00",
    currency: "CHF",
    description: "SBB CFF FFS",
    accountLabel: "Plusgirokonto CHF",
  },
];

describe("searchRows", () => {
  it("a date prefix matches the month or the day", () => {
    expect(searchRows(rows, "2026-07").map((r) => r.id)).toEqual(["a", "b"]);
    expect(searchRows(rows, "2026-06-30").map((r) => r.id)).toEqual(["c"]);
  });
  it("an amount within ± 1 % (sign and separators ignored)", () => {
    expect(searchRows(rows, "1297.20").map((r) => r.id)).toEqual(["a", "b"]);
    expect(searchRows(rows, "1 297,20").map((r) => r.id)).toEqual(["a", "b"]);
    expect(searchRows(rows, "45").map((r) => r.id)).toEqual(["c"]);
    expect(searchRows(rows, "1200")).toEqual([]);
  });
  it("text over the description and the account, case-folded", () => {
    expect(searchRows(rows, "chatgpt").map((r) => r.id)).toEqual(["b"]);
    expect(searchRows(rows, "konto chf").map((r) => r.id)).toEqual(["c"]);
    expect(searchRows(rows, "plusgirokonto chf").map((r) => r.id)).toEqual(["c"]);
    expect(searchRows(rows, "   ")).toEqual([]);
  });
});
