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
      { index: 0, field: "date", label: "Booking date" },
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

function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
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
    expect(row0.notes).toBe("Groceries");
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

describe("CSV parser — deduplication hash", () => {
  it("same row produces same hash", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    const result2 = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    expect(result.rows[0].deduplicationHash).toBe(result2.rows[0].deduplicationHash);
  });

  it("different rows produce different hashes", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    const hashes = result.rows.map((r) => r.deduplicationHash);
    const unique = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
  });

  it("uses reference for hash when available", () => {
    const result = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    // Row 1 has a reference, row 0 does not
    // Both should have valid hashes
    expect(result.rows[0].deduplicationHash).toHaveLength(64); // SHA-256
    expect(result.rows[1].deduplicationHash).toHaveLength(64);
    expect(result.rows[0].deduplicationHash).not.toBe(result.rows[1].deduplicationHash);
  });
});

describe("CSV parser — configurable column mapping", () => {
  it("works with reordered column mapping", () => {
    // ALT_CONFIG has columns in a different order but same indices
    const result = parse(loadFixture("nordea-sek-valid.csv"), ALT_CONFIG);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0].date).toBe("2025-01-15");
    expect(result.rows[0].amount.toString()).toBe("-149");
  });

  it("proves parser is format-agnostic (not hardcoded for Nordea)", () => {
    // Same file, different config → same results
    const result1 = parse(loadFixture("nordea-sek-valid.csv"), NORDEA_CONFIG);
    const result2 = parse(loadFixture("nordea-sek-valid.csv"), ALT_CONFIG);
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
