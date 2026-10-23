// The declaration's snapshot column: written through `snapshotToJson` (no `as unknown as`), read back through
// `parseSnapshot` — the lines a declaration stores are the lines it reads (lessons round 3, exports).
import { describe, expect, it } from "vitest";
import { parseSnapshot, snapshotToJson } from "./declaration-read";
import type { SwissVatLine } from "./types";

const lines: SwissVatLine[] = [
  {
    ref: "200",
    section: "I",
    labelFr: "Total des contre-prestations",
    labelEn: "Total consideration",
    source: "auto",
    amount: "12000.00",
  },
  {
    ref: "302",
    section: "II",
    labelFr: "Prestations imposables au taux normal",
    labelEn: "Taxable supplies at the standard rate",
    source: "calc",
    amount: "972.00",
    base: "12000.00",
    rate: "8.1",
  },
];

describe("snapshotToJson", () => {
  it("reads back as the same lines through parseSnapshot", () => {
    expect(parseSnapshot(snapshotToJson(lines))).toEqual(lines);
  });

  it("writes the optional base and rate only when a line has them", () => {
    const [plain, rated] = snapshotToJson(lines) as Record<string, unknown>[];
    expect(Object.keys(plain ?? {})).not.toContain("base");
    expect(Object.keys(plain ?? {})).not.toContain("rate");
    expect(rated).toMatchObject({ base: "12000.00", rate: "8.1" });
  });
});
