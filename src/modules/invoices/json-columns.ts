// The three JSONB columns of `invoices` — `printed_references`, `printed_parties`, `vat_by_rate` — typed once, both
// ways (lessons audit 29, the F50-b pattern): a read mapper checks the shape instead of casting `JsonValue` to the
// DTO, a write mapper hands Prisma an `InputJsonValue` without `as unknown as`. A valid value reads back as the
// very object stored (the guards narrow, they never rebuild), so what the sheet prints does not move.
import { z } from "zod/v4";
import type { Prisma } from "@/generated/prisma/browser";
import type { PrintedAddress, PrintedParties, PrintedReference, VatByRate } from "./types";

// --- shapes (lenient where old snapshots may lack a later field: `nullish`, never refused for it) ---

const text = z.string().nullish();

const referenceShape = z.object({ label: z.string(), value: z.string() });

const addressShape = z.object({
  street: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
});

const partiesShape = z.object({
  tenant: z.object({
    name: z.string(),
    orgNumber: text,
    address: text,
    email: text,
    website: text,
    logoUrl: text,
    vatNumber: text,
    vatCountry: text,
  }),
  partner: z.object({
    name: z.string(),
    address: addressShape.nullish(),
    vatNumber: text,
    orgNumber: text,
    email: text,
  }),
  bank: z
    .object({
      bankName: text,
      accountHolder: text,
      iban: text,
      bic: text,
      accountNumber: text,
      currency: z.string(),
    })
    .nullish(),
});

const vatRowShape = z.object({ rate: z.string(), base: z.string(), vat: z.string() });

function isReference(v: unknown): v is PrintedReference {
  return referenceShape.safeParse(v).success;
}
function isParties(v: unknown): v is PrintedParties {
  return partiesShape.safeParse(v).success;
}
function isVatRow(v: unknown): v is VatByRate {
  return vatRowShape.safeParse(v).success;
}

// --- read: JsonValue → DTO ---

/** The printed references; entries that do not read as `{label, value}` are left out, no column → `[]`. */
export function parsePrintedReferences(json: Prisma.JsonValue | null): PrintedReference[] {
  return Array.isArray(json) ? json.filter(isReference) : [];
}

/** The issue-time snapshot of the parties, or null (a draft, or a value that does not read as one). */
export function parsePrintedParties(json: Prisma.JsonValue | null): PrintedParties | null {
  return isParties(json) ? json : null;
}

/** VAT per rate; rows that do not read as `{rate, base, vat}` are left out, no column → `[]`. */
export function parseVatByRate(json: Prisma.JsonValue | null): VatByRate[] {
  return Array.isArray(json) ? json.filter(isVatRow) : [];
}

// --- write: DTO → InputJsonValue ---

export function printedReferencesToJson(refs: readonly PrintedReference[]): Prisma.InputJsonArray {
  return refs.map((r) => ({ label: r.label, value: r.value }));
}

/** Drops the undefined keys — what JSON serialisation did before, now visible to the type. */
function addressToJson(address: PrintedAddress | null | undefined): Prisma.InputJsonObject | null {
  if (!address) return null;
  return Object.fromEntries(
    Object.entries(address).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

export function printedPartiesToJson(p: PrintedParties): Prisma.InputJsonObject {
  return {
    tenant: { ...p.tenant },
    partner: { ...p.partner, address: addressToJson(p.partner.address) },
    bank: p.bank ? { ...p.bank } : null,
  };
}

export function vatByRateToJson(rows: readonly VatByRate[]): Prisma.InputJsonArray {
  return rows.map((r) => ({ rate: r.rate, base: r.base, vat: r.vat }));
}
