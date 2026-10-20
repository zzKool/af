import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BankFormatConfig } from "@/modules/banking/csv-parser";
import { parse, validateFormat } from "@/modules/banking/csv-parser";

const FIXTURES = join(__dirname, "__fixtures__");

// Nordea format config matching the seeded bank_formats data
const NORDEA_CONFIG: BankFormatConfig = {
  delimiter: ";",
  decimalSeparator: ",",
  dateFormat: "YYYY/MM/DD",
  encoding: "ISO-8859-1",
  columnMapping: {
    columns: [
      { index: 0, field: "date", label: "Booking date", aliases: ["Date"] },
      { index: 1, field: "amount", label: "Amount" },
      { index: 2, field: "sender", label: "Sender" },
      { index: 3, field: "recipient", label: "Recipient" },
      { index: 4, field: "name", label: "Name" },
      { index: 5, field: "details", label: "Additional details" },
      { index: 6, field: "message", label: "Message" },
      { index: 7, field: "notes", label: "Own notes" },
      { index: 8, field: "balance", label: "Balance" },
      { index: 9, field: "currency", label: "Currency" },
    ],
    hasHeader: true,
    skipRows: 0,
    trailingDelimiter: true,
    primaryDescriptionField: "name",
    referenceField: "message",
  },
};

// Alternative column mapping to prove parser is format-agnostic
const ALT_CONFIG: BankFormatConfig = {
  ...NORDEA_CONFIG,
  columnMapping: {
    ...NORDEA_CONFIG.columnMapping,
    columns: [
      { index: 0, field: "date", label: "Date" },
      { index: 1, field: "amount", label: "Sum" },
      { index: 9, field: "currency", label: "Curr" },
      { index: 4, field: "name", label: "Desc" },
      { index: 2, field: "sender", label: "From" },
      { index: 5, field: "details", label: "Info" },
      { index: 6, field: "message", label: "Ref" },
      { index: 7, field: "notes", label: "Notes" },
      { index: 8, field: "balance", label: "Bal" },
      { index: 3, field: "recipient", label: "To" },
    ],
  },
};

const SPEC_FIXTURES = join(__dirname, "..", "..", "..", "specs", "banking", "fixtures");

function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

function loadSpecFixture(name: string): Buffer {
  return readFileSync(join(SPEC_FIXTURES, name));
}

/** the same file with its header line replaced (to exercise another column mapping) */
function withHeader(file: Buffer, header: string): Buffer {
  const text = new TextDecoder("ISO-8859-1").decode(file);
  const [, ...rest] = text.split(/\r?\n/);
  return Buffer.from([header, ...rest].join("\n"), "latin1");
}

describe("CSV parser — valid SEK file", () => {
  it("parses all fields from SEK CSV", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    expect(result.rows).toHaveLength(5);
    expect(result.errors).toHaveLength(0);

    const row0 = result.rows[0];
    expect(row0.date).toBe("2025-01-15"); // ISO 8601
    expect(row0.amount.toString()).toBe("-149");
    expect(row0.currency).toBe("SEK");
    expect(row0.description).toBe("KORT KOP LIVSMEDEL AB");
    expect(row0.reference).toBeNull(); // No message field
    expect(row0.ownNotes).toBe("Groceries");
    expect(row0.name).toBe("KORT KOP LIVSMEDEL AB");
    expect(row0.counterpartyKey).toBe("LIVSMEDEL AB");
    expect(row0.rowIndex).toBe(0);
    expect(row0.occurrence).toBe(0);
    expect(row0.balance?.toString()).toBe("12345.67");
  });

  it("extracts amounts as Decimal (not number)", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    const row = result.rows[0];
    // Prisma.Decimal is a Decimal-like object (may be "Decimal" or "Decimal2" depending on version)
    expect(typeof row.amount.toString).toBe("function");
    expect(typeof row.amount.isNegative).toBe("function");
  });

  it("converts dates to ISO 8601", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    for (const row of result.rows) {
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("preserves all 10 raw fields", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    const raw = result.rows[0].rawFields;
    expect(Object.keys(raw)).toHaveLength(10);
    expect(raw.date).toBe("2025/01/15");
    expect(raw.amount).toBe("-149,00");
    expect(raw.currency).toBe("SEK");
  });

  it("extracts reference from message field", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    // Row 1 has a /ROC/ reference in the message field
    expect(result.rows[1].reference).toBe("/ROC/PMT-10026655-5681836");
  });
});

describe("CSV parser — CHF file", () => {
  it("parses cross-currency CSV", () => {
    const result = parse(loadFixture("nordea-chf-valid.csv"), NORDEA_CONFIG);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].currency).toBe("CHF");
    expect(result.rows[0].amount.toString()).toBe("-500.25");
    expect(result.rows[0].reference).toBe("/ROC/PMT-30045678-9876543");
  });
});

describe("CSV parser — interest file (description resolution)", () => {
  it("falls back to details when name is empty", () => {
    const result = parse(loadFixture("nordea-interest.csv"), NORDEA_CONFIG);
    expect(result.rows).toHaveLength(1);
    // Name is empty, details = "Interest 2024"
    expect(result.rows[0].description).toBe("Interest 2024");
  });
});

describe("CSV parser — amounts", () => {
  it("handles negative amounts (debit)", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    expect(result.rows[0].amount.isNegative()).toBe(true);
  });

  it("handles positive amounts (credit)", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    // Row 2 is salary: 25000,00
    expect(result.rows[2].amount.isPositive()).toBe(true);
    expect(result.rows[2].amount.toString()).toBe("25000");
  });

  it("handles empty balance field as null", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    // Row 4 has no balance
    expect(result.rows[4].balance).toBeNull();
  });
});

describe("CSV parser — empty and headers-only files", () => {
  it("rejects empty file (0 bytes)", () => {
    const result = parse(loadFixture("nordea-empty.csv"), NORDEA_CONFIG);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toContain("File is empty (0 bytes)");
  });

  it("rejects headers-only file (no data rows)", () => {
    const result = parse(loadFixture("nordea-headers-only.csv"), NORDEA_CONFIG);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toContain("No data rows found (headers only or empty)");
  });
});

describe("CSV parser — encoding", () => {
  it("preserves Swedish characters from ISO-8859-1", () => {
    const result = parse(loadFixture("nordea-encoding.csv"), NORDEA_CONFIG);
    expect(result.rows).toHaveLength(1);
    // ´ (acute accent 0xB4), ö (0xF6), ä (0xE4), Å (0xC5)
    expect(result.rows[0].description).toBe("Skattepunkten\u00B4s AB");
    expect(result.rows[0].rawFields.details).toContain("\u00F6"); // ö
    expect(result.rows[0].rawFields.details).toContain("\u00E4"); // ä
    expect(result.rows[0].rawFields.details).toContain("\u00C5"); // Å
  });

  it("decodes the owner's real export: UTF-8 with a BOM, although the format says ISO-8859-1", () => {
    const header =
      "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";
    const row =
      "2026/07/28;-198,52;;;;Kortköp 260727 OPENAI *CHATGPT SUBS;OPENAI *CHATGPT 6482;;1514,76;SEK;";
    const utf8WithBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(`${header}\n${row}\n`, "utf8"),
    ]);
    const result = parse(utf8WithBom, NORDEA_CONFIG); // ISO-8859-1 config
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.description).toBe("Kortköp 260727 OPENAI *CHATGPT SUBS");
    // UTF-8 without a BOM decodes the same way; Latin-1 bytes still take the format's encoding
    const utf8 = Buffer.from(`${header}\n${row}\n`, "utf8");
    expect(parse(utf8, NORDEA_CONFIG).rows[0]?.description).toBe(
      "Kortköp 260727 OPENAI *CHATGPT SUBS",
    );
    const latin1 = Buffer.from(`${header}\n${row}\n`, "latin1");
    expect(parse(latin1, NORDEA_CONFIG).rows[0]?.description).toBe(
      "Kortköp 260727 OPENAI *CHATGPT SUBS",
    );
  });

  it("handles BOM prefix gracefully", () => {
    // BOM file is UTF-8 encoded, but we use ISO-8859-1 decoder
    // which should still work for ASCII-range content
    const bomConfig = { ...NORDEA_CONFIG, encoding: "utf-8" };
    const result = parse(loadFixture("nordea-bom.csv"), bomConfig);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amount.toString()).toBe("-100");
  });
});

describe("CSV parser — quoted semicolons", () => {
  it("handles quoted fields containing semicolons", () => {
    const result = parse(loadFixture("nordea-quoted-semicolons.csv"), NORDEA_CONFIG);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].description).toBe("Vendor; with semicolons");
  });
});

describe("CSV parser — deduplication hash (D25)", () => {
  it("same row produces same hash", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    const result2 = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    expect(result.rows[0].dedupHash).toBe(result2.rows[0].dedupHash);
  });

  it("different rows produce different hashes", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    const hashes = result.rows.map((r) => r.dedupHash);
    const unique = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
    for (const h of hashes) expect(h).toHaveLength(64);
  });

  it("the hash does not depend on the row's position, the balance or the own notes", () => {
    const file = loadFixture("nordea-sek-valid.csv");
    const text = new TextDecoder("ISO-8859-1").decode(file);
    const lines = text.split(/\r?\n/).filter((l) => l !== "");
    // drop the first data row → every other row shifts up one position
    const shifted = Buffer.from([lines[0], ...lines.slice(2)].join("\n"), "latin1");
    const full = parse(file, NORDEA_CONFIG).rows;
    const less = parse(shifted, NORDEA_CONFIG).rows;
    expect(less.map((r) => r.dedupHash)).toEqual(full.slice(1).map((r) => r.dedupHash));
    // same row, other balance and other own notes → same hash
    const cols = lines[1].split(";");
    cols[7] = "something else";
    cols[8] = "1,00";
    const edited = Buffer.from([lines[0], cols.join(";")].join("\n"), "latin1");
    expect(parse(edited, NORDEA_CONFIG).rows[0].dedupHash).toBe(full[0].dedupHash);
  });

  it("two identical rows in one file share the hash and get occurrence 0 and 1", () => {
    const result = parse(loadSpecFixture("nordea-bank-fee-duplicate-rows.csv"), NORDEA_CONFIG);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].dedupHash).toBe(result.rows[1].dedupHash);
    expect(result.rows.map((r) => r.occurrence)).toEqual([0, 1]);
    expect(result.rows[0].counterpartyKey).toBe("AVGIFTER NORDEA");
  });
});

describe("CSV parser — the owner's July 2026 export (D25)", () => {
  it("accepts the `Date` header, empty Name on card rows, sparse balance", () => {
    const result = parse(loadSpecFixture("nordea-2026-07-sek-sample.csv"), NORDEA_CONFIG);
    expect(result.errors).toHaveLength(0);
    expect(result.rows.length).toBeGreaterThan(10);
    const openai = result.rows.find((r) => r.additionalDetails?.includes("OPENAI"));
    expect(openai?.name).toBeNull();
    expect(openai?.description).toBe("Kortköp 260727 OPENAI *CHATGPT SUBS");
    expect(openai?.counterpartyKey).toBe("OPENAI *CHATGPT SUBS");
    expect(openai?.reference).toBe("OPENAI *CHATGPT 1234");
    expect(result.rows.some((r) => r.balance === null)).toBe(true);
    expect(result.rows.some((r) => r.balance !== null)).toBe(true);
  });

  it("rejects the v1 Swedish-header file (comma-delimited) as not a Nordea export", () => {
    const result = validateFormat(loadSpecFixture("v1-swedish-headers.csv"), NORDEA_CONFIG);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/^Unexpected columns: expected "Booking date\/Date; Amount/);
  });

  it("accepts a space thousands separator and reports an invalid amount per row", () => {
    const header =
      "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";
    const file = Buffer.from(
      [
        header,
        "2026/07/08;-1 500,00;;;Something AB;;;;;SEK;",
        "2026/07/09;abc;;;Broken;;;;;SEK;",
        "2026/13/40;10,00;;;Bad date;;;;;SEK;",
        "2026/07/10;12.345,67;;;Dotted AB;;;;;SEK;",
      ].join("\n"),
      "latin1",
    );
    const result = parse(file, NORDEA_CONFIG);
    expect(result.rows.map((r) => r.amount.toFixed(2))).toEqual(["-1500.00", "12345.67"]);
    expect(result.errors).toEqual([
      'Row 2: invalid amount "abc"',
      'Row 3: invalid date "2026/13/40"',
    ]);
  });
});

describe("CSV parser — configurable column mapping", () => {
  const ALT_HEADER = "Date;Sum;From;To;Desc;Info;Ref;Notes;Bal;Curr;";

  it("works with reordered column mapping", () => {
    // ALT_CONFIG has columns in a different order but same indices
    const result = parse(withHeader(loadFixture("nordea-sek-valid.csv"), ALT_HEADER), ALT_CONFIG);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0].date).toBe("2025-01-15");
    expect(result.rows[0].amount.toString()).toBe("-149");
  });

  it("proves parser is format-agnostic (not hardcoded for Nordea)", () => {
    // Same file, different config → same results
    const result1 = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    const result2 = parse(withHeader(loadFixture("nordea-sek-valid.csv"), ALT_HEADER), ALT_CONFIG);
    expect(result1.rows.length).toBe(result2.rows.length);
    expect(result1.rows[0].amount.toString()).toBe(result2.rows[0].amount.toString());
  });
});

describe("CSV parser — validation", () => {
  it("validates empty file", () => {
    const result = validateFormat(loadFixture("nordea-empty.csv"), NORDEA_CONFIG);
    expect(result.valid).toBe(false);
  });

  it("validates headers-only file", () => {
    const result = validateFormat(loadFixture("nordea-headers-only.csv"), NORDEA_CONFIG);
    expect(result.valid).toBe(false);
  });

  it("validates valid file", () => {
    const result = validateFormat(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    expect(result.valid).toBe(true);
  });
});

// Local-only validation against real files (skipped in CI)
describe.skipIf(!existsSync("prisma/data/PLUSGIROKONTO FTG 211 53 13-5 - 2025-02-06 23.33.02.csv"))(
  "real Nordea CSV validation",
  () => {
    it("parses SEK Plusgiro file (10 rows)", () => {
      const file = readFileSync(
        "prisma/data/PLUSGIROKONTO FTG 211 53 13-5 - 2025-02-06 23.33.02.csv",
      );
      const result = parse(file, NORDEA_CONFIG);
      expect(result.rows.length).toBe(10);
      expect(result.errors).toHaveLength(0);
    });

    it("parses CHF Plusgiro file (1 row, CHF currency)", () => {
      const file = readFileSync(
        "prisma/data/PLUSGIROKONTO FTG 211 53 13-5 - 2025-02-06 23.33.35.csv",
      );
      const result = parse(file, NORDEA_CONFIG);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].currency).toBe("CHF");
      expect(result.rows[0].reference).toMatch(/^\/ROC\//);
    });

    it("parses Savings file (description from details, not empty name)", () => {
      const file = readFileSync(
        "prisma/data/SPARKONTO F\u00D6RETAG 1195 32 74218 - 2025-02-06 23.31.03.csv",
      );
      const result = parse(file, NORDEA_CONFIG);
      expect(result.rows.length).toBe(1);
      // Name should be empty, description resolved from details ("Ränta 2024")
      expect(result.rows[0].description).toContain("nta");
    });
  },
);
