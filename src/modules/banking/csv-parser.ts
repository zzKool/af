// Nordea CSV parser (v2, kept; D25 edits marked). Pure: a buffer + a format config → rows with Decimal
// amounts, the raw columns by field, the derived text (description, reference, counterparty key) and the
// dedup key. The hash covers the raw columns of the row — never the row's position, the balance (end-of-day
// only) or the owner's own notes (editable in Nordea); identical rows of one file are told apart by `occurrence`.
import { createHash } from "node:crypto";
import Papa from "papaparse";
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/client";
import { counterpartyKey } from "./counterparty";

export interface BankFormatColumn {
  index: number;
  field: string;
  label: string;
  /** other header texts the bank prints for the same column (`Date` for `Booking date`, D25) */
  aliases?: string[];
}

const columnMappingSchema = z.object({
  columns: z
    .array(
      z.object({
        index: z.number().int().min(0),
        field: z.string().min(1),
        label: z.string(),
        aliases: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  hasHeader: z.boolean(),
  skipRows: z.number().int().min(0),
  trailingDelimiter: z.boolean(),
  primaryDescriptionField: z.string(),
  referenceField: z.string(),
});

/**
 * `bank_formats.column_mapping` (JSONB) read into the mapping the parser uses — the F50-b pattern, a parse on read
 * instead of a cast (lessons audit 29). Null when the stored JSON does not fit, so a broken format is refused with
 * a message rather than failing somewhere inside the parser.
 */
export function parseColumnMapping(json: unknown): BankFormatConfig["columnMapping"] | null {
  const parsed = columnMappingSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export interface BankFormatConfig {
  delimiter: string;
  decimalSeparator: string;
  dateFormat: string;
  encoding: string;
  columnMapping: {
    columns: BankFormatColumn[];
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
  balance: Prisma.Decimal | null;
  // the six raw text columns, trimmed, null when empty
  sender: string | null;
  recipient: string | null;
  name: string | null;
  additionalDetails: string | null;
  message: string | null;
  ownNotes: string | null;
  description: string; // Resolved: name || details || sender || recipient || "Unknown transaction"
  reference: string | null; // the reference column (Message), verbatim
  counterpartyKey: string;
  dedupHash: string;
  /** 0-based index among the rows of this file that share the hash */
  occurrence: number;
  /** 0-based position among the data rows of the file — provenance only */
  rowIndex: number;
  rawFields: Record<string, string>;
}

/**
 * The rows that parsed and, row by row, the ones that did not. A file with any error is **not importable**
 * (F109 — audit 2026-10-27 B5): the import refuses it whole and names every bad row, so the owner fixes the
 * export or the format once; a silently missing row would be the worst outcome for proof-per-transaction books.
 */
export interface ParseResult {
  rows: ParsedRow[];
  errors: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** a real calendar date in ISO form, or null */
function isoDate(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

function convertDate(dateStr: string, dateFormat: string): string | null {
  const s = dateStr.trim();
  // YYYY/MM/DD → YYYY-MM-DD (ISO 8601)
  if (dateFormat === "YYYY/MM/DD") {
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return null;
    return isoDate(s.replace(/\//g, "-"));
  }
  // DD/MM/YYYY → YYYY-MM-DD
  if (dateFormat === "DD/MM/YYYY") {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return null;
    const [day, month, year] = s.split("/");
    return isoDate(`${year}-${month}-${day}`);
  }
  return isoDate(s);
}

/** `-1 500,00` / `1.500,00` / `-149,00` → Decimal; null when not a number (D25: a space thousands separator is accepted) */
function parseAmount(value: string, decimalSeparator: string): Prisma.Decimal | null {
  const compact = value.replace(/[\s ]/g, "");
  if (compact === "") return null;
  const normalized =
    decimalSeparator === "," ? compact.replace(/\./g, "").replace(",", ".") : compact;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return new Prisma.Decimal(normalized);
}

/** sha256 over the raw columns — the dedup key of D25 (the account is the index's scope). */
export function dedupHash(parts: {
  date: string;
  amount: string;
  currency: string;
  sender: string | null;
  recipient: string | null;
  name: string | null;
  additionalDetails: string | null;
  message: string | null;
}): string {
  const input = [
    parts.date,
    parts.amount,
    parts.currency,
    parts.sender ?? "",
    parts.recipient ?? "",
    parts.name ?? "",
    parts.additionalDetails ?? "",
    parts.message ?? "",
  ].join("|");
  return createHash("sha256").update(input).digest("hex");
}

function resolveDescription(fields: Record<string, string>, primaryField: string): string {
  // Resolution chain: primaryDescriptionField → details → sender → recipient → "Unknown transaction"
  for (const key of [primaryField, "details", "sender", "recipient"]) {
    const v = fields[key]?.trim();
    if (v) return v;
  }
  return "Unknown transaction";
}

/**
 * Decode a CSV buffer to text. The format says ISO-8859-1, but Nordea's real exports arrive as UTF-8 with a BOM
 * (seen 2026-10 on the owner's file: decoded as Latin-1 the BOM became `ï»¿Date` and the header was refused), so
 * the bytes decide: a BOM or a clean UTF-8 decode with multi-byte characters → UTF-8, else the format's encoding.
 */
export function decodeBuffer(file: Buffer, encoding: string): string {
  const hasBom = file.length >= 3 && file[0] === 0xef && file[1] === 0xbb && file[2] === 0xbf;
  if (hasBom) return new TextDecoder("utf-8").decode(file.subarray(3));
  if (file.some((b) => b >= 0x80)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(file);
    } catch {
      // not valid UTF-8 — Latin-1 after all
    }
  }
  return new TextDecoder(encoding).decode(file).replace(/^\uFEFF/, "");
}

function parseRaw(cleaned: string, config: BankFormatConfig): string[][] {
  const result = Papa.parse<string[]>(cleaned, {
    delimiter: config.delimiter,
    header: false,
    skipEmptyLines: true,
  });
  return result.data;
}

/** The header must carry the format's labels (or their aliases) at the mapped indexes — else it is not this bank's export. */
export function headerError(header: string[], config: BankFormatConfig): string | null {
  const expected: string[] = [];
  let ok = true;
  for (const col of config.columnMapping.columns) {
    const accepted = [col.label, ...(col.aliases ?? [])];
    expected.push(accepted.join("/"));
    const got = (header[col.index] ?? "").trim().toLowerCase();
    if (!accepted.some((a) => a.toLowerCase() === got)) ok = false;
  }
  if (ok) return null;
  return `Unexpected columns: expected "${expected.join("; ")}", got "${header
    .filter((h) => h !== "")
    .join("; ")}"`;
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

  const cleaned = decodeBuffer(file, config.encoding);

  if (cleaned.trim() === "") {
    errors.push("File is empty after decoding");
    return { valid: false, errors };
  }

  const data = parseRaw(cleaned, config);
  const { hasHeader, skipRows } = config.columnMapping;

  if (hasHeader) {
    const header = data[skipRows] ?? [];
    const err = headerError(header, config);
    if (err) {
      errors.push(err);
      return { valid: false, errors };
    }
  }

  const dataRows = hasHeader ? data.slice(1 + skipRows) : data.slice(skipRows);

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

  const cleaned = decodeBuffer(file, config.encoding);
  const data = parseRaw(cleaned, config);

  const errors: string[] = [];
  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();

  // Skip header rows
  const startIndex = (config.columnMapping.hasHeader ? 1 : 0) + config.columnMapping.skipRows;
  const dataRows = data.slice(startIndex);

  const { columns, trailingDelimiter, primaryDescriptionField, referenceField } =
    config.columnMapping;

  for (let i = 0; i < dataRows.length; i++) {
    let row = dataRows[i];

    // Handle trailing delimiter: last element is empty string
    if (trailingDelimiter && row.length > 0 && row[row.length - 1] === "") {
      row = row.slice(0, -1);
    }

    // Build raw fields from column mapping (the text is stored as the bank wrote it — nothing here is a spreadsheet)
    const rawFields: Record<string, string> = {};
    for (const col of columns) {
      rawFields[col.field] = row[col.index] ?? "";
    }

    // Extract key fields
    const dateRaw = rawFields.date ?? "";
    const amountRaw = rawFields.amount ?? "";
    const currencyRaw = rawFields.currency ?? "";

    if (!dateRaw.trim() || !amountRaw.trim()) {
      errors.push(`Row ${i + 1}: missing required field (date or amount)`);
      continue;
    }

    const date = convertDate(dateRaw, config.dateFormat);
    if (!date) {
      errors.push(`Row ${i + 1}: invalid date "${dateRaw}"`);
      continue;
    }
    const amount = parseAmount(amountRaw, config.decimalSeparator);
    if (!amount) {
      errors.push(`Row ${i + 1}: invalid amount "${amountRaw}"`);
      continue;
    }

    const currency = currencyRaw.trim().toUpperCase() || "SEK";
    const text = (key: string): string | null => {
      const v = rawFields[key]?.trim();
      return v ? v : null;
    };
    const sender = text("sender");
    const recipient = text("recipient");
    const name = text("name");
    const additionalDetails = text("details");
    const message = text("message");
    const ownNotes = text("notes");
    const description = resolveDescription(rawFields, primaryDescriptionField);
    const reference = text(referenceField);
    const balanceRaw = rawFields.balance?.trim() ?? "";
    const balance = balanceRaw ? parseAmount(balanceRaw, config.decimalSeparator) : null;

    const hash = dedupHash({
      date,
      amount: amount.toFixed(2),
      currency,
      sender,
      recipient,
      name,
      additionalDetails,
      message,
    });
    const occurrence = seen.get(hash) ?? 0;
    seen.set(hash, occurrence + 1);

    rows.push({
      date,
      amount,
      currency,
      balance,
      sender,
      recipient,
      name,
      additionalDetails,
      message,
      ownNotes,
      description,
      reference,
      counterpartyKey: counterpartyKey({ name, additionalDetails, message, sender, recipient }),
      dedupHash: hash,
      occurrence,
      rowIndex: i,
      rawFields,
    });
  }

  return { rows, errors };
}
