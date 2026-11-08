// D68 (F148): the parser of BAS's two files, on invented rows shaped like theirs — the groups, the main accounts
// (`NNN0`, column A of the Swedish file), the sub-accounts (column C) under the main account of their row, the
// K2 mark (`#`) dropped from the code, the English names by four-digit code or by the three-digit main account.
import { describe, expect, it } from "vitest";
import { parseChart } from "../../../prisma/data/parse-bas.mjs";

const SV = [
  ["KONTOPLAN BAS 2026"],
  ["Huvudkonton", null, "Underkonton"],
  [65, "ÖVRIGA EXTERNA TJÄNSTER"],
  ["6530", "Redovisningstjänster"],
  ["6540#", "IT-tjänster", "6541", "Drift av IT"],
  [null, null, "6542", "Support"],
  [58, "RESEKOSTNADER"],
  ["5800", "Resekostnader", "5809", "Övriga resekostnader"],
];
const EN = [
  [null, null, 6, "Other external costs"],
  [null, null, 65, "Other external services"],
  [null, null, 653, "Accounting services", null, null, 6530, "Accounting services"],
  [null, "■", 654, "IT services", null, null, 6541, "IT operations"],
  [null, null, 58, "Travel expenses"],
];

describe("parseChart", () => {
  const { groups, accounts } = parseChart(SV, EN);

  it("the two-digit groups with their English names", () => {
    expect(groups).toEqual([
      {
        code: "65",
        classNum: 6,
        name: "ÖVRIGA EXTERNA TJÄNSTER",
        nameEn: "Other external services",
      },
      { code: "58", classNum: 5, name: "RESEKOSTNADER", nameEn: "Travel expenses" },
    ]);
  });

  it("main accounts and sub-accounts at four digits, in code order, each in its group", () => {
    expect(
      accounts.map((a: { code: string; kind: string; parentCode: string | null }) => [
        a.code,
        a.kind,
        a.parentCode,
      ]),
    ).toEqual([
      ["5800", "main", null],
      ["5809", "sub", "5800"],
      ["6530", "main", null],
      ["6540", "main", null],
      ["6541", "sub", "6540"],
      ["6542", "sub", "6540"],
    ]);
    expect(accounts.find((a: { code: string }) => a.code === "6542")).toMatchObject({
      groupCode: "65",
      classNum: 6,
      name: "Support",
    });
  });

  it("English: the four-digit name first, else the main account's; none stays null", () => {
    const en = (c: string) => accounts.find((a: { code: string }) => a.code === c)?.nameEn;
    expect(en("6530")).toBe("Accounting services");
    expect(en("6540")).toBe("IT services"); // from the main account `654`
    expect(en("6541")).toBe("IT operations");
    expect(en("6542")).toBeNull();
  });
});
