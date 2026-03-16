import { createHash } from "node:crypto";
import Papa from "papaparse";
import { Prisma } from "@/generated/prisma/client";

export interface BankFormatConfig {
  delimiter: string;
  decimalSeparator: string;
  dateFormat: string;
  encoding: string;
  columnMapping: {
    columns: Array<{ index: number; field: string; label: string }>;
    hasHeader: boolean;
    skipRows: number;
    trailingDelimiter: boolean;
    primaryDescriptionField: string;
    referenceField: string;
  };
}

export interface ParsedRow {
  date: string; // ISO 8601 (converted from source format)
  amount: Prisma.Decimal;
  currency: string;
  description: string; // Resolved: name || details || sender || "Unknown transaction"
  reference: string | null;
  notes: string | null;
  balance: Prisma.Decimal | null;
  deduplicationHash: string;
  rawFields: Record<string, string>;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * CSV formula injection sanitization.
 * Values starting with =, +, -, @ could be interpreted as formulas
 * by spreadsheet software. We flag these but don't modify the data
 * since we're parsing (not displaying in spreadsheet context).
 */
function isSuspiciousValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const firstChar = trimmed[0];
  // Allow negative numbers (start with - followed by digit or comma-decimal)
  if (firstChar === "-" && /^-[\d,.]/.test(trimmed)) return false;
  return ["=", "+", "-", "@"].includes(firstChar);
}

function convertDate(dateStr: string, dateFormat: string): string {
  // YYYY/MM/DD → YYYY-MM-DD (ISO 8601)
  if (dateFormat === "YYYY/MM/DD") {
    return dateStr.replace(/\//g, "-");
  }
  // DD/MM/YYYY → YYYY-MM-DD
  if (dateFormat === "DD/MM/YYYY") {
    const [day, month, year] = dateStr.split("/");
    return `${year}-${month}-${day}`;
  }
  // Default: return as-is
  return dateStr;
}

function parseAmount(value: string, decimalSeparator: string): Prisma.Decimal | null {
  if (!value || value.trim() === "") return null;
  // Replace comma decimal with dot for Prisma.Decimal
  const normalized = decimalSeparator === "," ? value.replace(/\./g, "").replace(",", ".") : value;
  return new Prisma.Decimal(normalized.trim());
}

function computeHash(
  date: string,
  amount: string,
  reference: string | null,
  description: string,
  rowIndex: number,
): string {
  const input = reference
    ? `${date}|${amount}|${reference}`
    : `${date}|${amount}|${description}|${rowIndex}`;
  return createHash("sha256").update(input).digest("hex");
}

function resolveDescription(fields: Record<string, string>, primaryField: string): string {
  // Resolution chain: primaryDescriptionField → details → sender → "Unknown transaction"
  const name = fields[primaryField]?.trim();
  if (name) return name;

  const details = fields.details?.trim();
  if (details) return details;

  const sender = fields.sender?.trim();
  if (sender) return sender;

  return "Unknown transaction";
}

/**
 * Validate a CSV buffer against a bank format configuration.
 */
export function validateFormat(file: Buffer, config: BankFormatConfig): ValidationResult {
  const errors: string[] = [];

  if (file.length === 0) {
    errors.push("File is empty (0 bytes)");
    return { valid: false, errors };
  }

  // Decode from configured encoding
  const text = new TextDecoder(config.encoding).decode(file);

  // Strip BOM if present
  const cleaned = text.replace(/^\uFEFF/, "");

  if (cleaned.trim() === "") {
    errors.push("File is empty after decoding");
    return { valid: false, errors };
  }

  const result = Papa.parse(cleaned, {
    delimiter: config.delimiter,
    header: false,
    skipEmptyLines: true,
  });

  const dataRows = config.columnMapping.hasHeader
    ? result.data.slice(1 + config.columnMapping.skipRows)
    : result.data.slice(config.columnMapping.skipRows);

  if (dataRows.length === 0) {
    errors.push("No data rows found (headers only or empty)");
    return { valid: false, errors };
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parse a CSV file buffer using the given bank format configuration.
 * Returns parsed rows with Decimal amounts, resolved descriptions,
 * and deduplication hashes.
 */
export function parse(file: Buffer, config: BankFormatConfig): ParseResult {
  const validation = validateFormat(file, config);
  if (!validation.valid) {
    return { rows: [], errors: validation.errors };
  }

  // Decode from configured encoding
  const text = new TextDecoder(config.encoding).decode(file);

  // Strip BOM if present
  const cleaned = text.replace(/^\uFEFF/, "");

  const result = Papa.parse<string[]>(cleaned, {
    delimiter: config.delimiter,
    header: false,
    skipEmptyLines: true,
  });

  const errors: string[] = [];
  const rows: ParsedRow[] = [];

  // Skip header rows
  const startIndex = (config.columnMapping.hasHeader ? 1 : 0) + config.columnMapping.skipRows;
  const dataRows = result.data.slice(startIndex);

  const { columns, trailingDelimiter, primaryDescriptionField, referenceField } =
    config.columnMapping;

  // Build field lookup from column mapping
  const fieldByIndex = new Map(columns.map((c) => [c.index, c.field]));

  for (let i = 0; i < dataRows.length; i++) {
    let row = dataRows[i];

    // Handle trailing delimiter: last element is empty string
    if (trailingDelimiter && row.length > 0 && row[row.length - 1] === "") {
      row = row.slice(0, -1);
    }

    // Build raw fields from column mapping
    const rawFields: Record<string, string> = {};
    for (const col of columns) {
      const value = row[col.index] ?? "";
      rawFields[col.field] = value;

      // Check for suspicious values (formula injection)
      if (isSuspiciousValue(value)) {
        errors.push(
          `Row ${i + 1}, column "${col.field}": suspicious value starting with formula character`,
        );
      }
    }

    // Extract key fields
    const dateRaw = rawFields.date ?? "";
    const amountRaw = rawFields.amount ?? "";
    const currencyRaw = rawFields.currency ?? "";

    if (!dateRaw || !amountRaw) {
      errors.push(`Row ${i + 1}: missing required field (date or amount)`);
      continue;
    }

    const date = convertDate(dateRaw, config.dateFormat);
    const amount = parseAmount(amountRaw, config.decimalSeparator);
    if (!amount) {
      errors.push(`Row ${i + 1}: invalid amount "${amountRaw}"`);
      continue;
    }

    const currency = currencyRaw.trim() || "SEK";
    const description = resolveDescription(rawFields, primaryDescriptionField);
    const referenceValue = rawFields[referenceField]?.trim() || null;
    const notes = rawFields.notes?.trim() || null;
    const balanceRaw = rawFields.balance?.trim() ?? "";
    const balance = balanceRaw ? parseAmount(balanceRaw, config.decimalSeparator) : null;

    const deduplicationHash = computeHash(date, amount.toString(), referenceValue, description, i);

    rows.push({
      date,
      amount,
      currency,
      description,
      reference: referenceValue,
      notes,
      balance,
      deduplicationHash,
      rawFields,
    });
  }

  return { rows, errors };
}
