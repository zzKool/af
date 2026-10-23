// The checks a write runs before it writes anything: amounts, lines, category alias, supplier, VAT registration,
// the supplier's number (unique, D35), and `isOpen` — the money facts are a draft until the first payment (D37).
import { Prisma } from "@/generated/prisma/browser";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { invalid, notFound, violation } from "./errors";
import type { LineInput } from "./schemas";

const D = Prisma.Decimal;

// --- validation ---

const TOTAL_TOLERANCE = new D("0.01");

export function checkAmounts(net: string, vat: string, total: string): AppError | null {
  const n = new D(net);
  const v = new D(vat);
  const t = new D(total);
  if (v.lt(0) || n.lt(0)) return invalid("Net and VAT cannot be negative");
  if (t.minus(n.plus(v)).abs().gt(TOTAL_TOLERANCE)) {
    return invalid(`Total ${t.toFixed(2)} must equal net ${n.toFixed(2)} + VAT ${v.toFixed(2)}`);
  }
  return null;
}

export function checkLines(
  lines: LineInput[] | undefined,
  net: string,
  vat: string,
): AppError | null {
  if (!lines || lines.length === 0) return null;
  const nos = new Set<number>();
  let sumNet = new D(0);
  let sumVat = new D(0);
  for (const l of lines) {
    if (nos.has(l.lineNo)) return invalid("Line numbers must be unique");
    nos.add(l.lineNo);
    sumNet = sumNet.plus(l.amountNet);
    sumVat = sumVat.plus(l.vatAmount);
  }
  if (sumNet.minus(net).abs().gt(TOTAL_TOLERANCE))
    return invalid(
      `The lines' net ${sumNet.toFixed(2)} must equal the invoice net ${new D(net).toFixed(2)}`,
    );
  if (sumVat.minus(vat).abs().gt(TOTAL_TOLERANCE))
    return invalid(
      `The lines' VAT ${sumVat.toFixed(2)} must equal the invoice VAT ${new D(vat).toFixed(2)}`,
    );
  return null;
}

export async function resolveAlias(
  tx: TransactionClient,
  code: string,
): Promise<ServiceResult<string>> {
  const cat = await settings.getBasCategory(tx, code);
  if (!cat) return { error: notFound("BAS category", code) };
  const alias = await settings.basAlias(tx, code);
  if (!alias) {
    return {
      error: violation(
        `Category ${code} ${cat.name} has no short code — set one under Settings → BAS categories`,
        { basCode: code },
      ),
    };
  }
  if (!/^[A-Za-z]{1,6}$/.test(alias)) {
    return {
      error: violation(
        `The short code "${alias}" of category ${code} must be 1–6 letters to be part of a key`,
      ),
    };
  }
  return { data: alias };
}

export async function resolveSupplier(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<partners.PartnerDto>> {
  const p = await partners.getPartner(tx, id);
  if (!p.data) return { error: notFound("Supplier", id) };
  if (!p.data.types.includes("vendor")) {
    return { error: violation(`${p.data.name} is not a vendor — add the type on the partner`) };
  }
  return { data: p.data };
}

export async function checkVatRegistration(
  tx: TransactionClient,
  caller: CallerIdentity,
  id: string | null | undefined,
): Promise<AppError | null> {
  if (!id) return null;
  const regs = await settings.getVatRegistrations(tx, caller);
  if (!(regs.data ?? []).some((r) => r.id === id)) return notFound("VAT registration", id);
  return null;
}

export async function checkLineCategories(
  tx: TransactionClient,
  lines: LineInput[] | undefined,
): Promise<AppError | null> {
  for (const l of lines ?? []) {
    if (!(await settings.getBasCategory(tx, l.basCode))) return notFound("BAS category", l.basCode);
  }
  return null;
}

/** The same supplier never gets the same number twice (case- and space-insensitive). */
export async function checkDuplicateNumber(
  tx: TransactionClient,
  partnerId: string,
  invoiceNumber: string,
  exceptId?: string,
): Promise<AppError | null> {
  const rows = await tx.$queryRawUnsafe<{ id: string; key: string }[]>(
    `SELECT id, key FROM supplier_invoices WHERE partner_id = $1::uuid AND lower(btrim(invoice_number)) = lower(btrim($2)) LIMIT 2`,
    partnerId,
    invoiceNumber,
  );
  const hit = rows.find((r) => r.id !== exceptId);
  if (hit)
    return violation(
      `Invoice ${invoiceNumber} of this supplier is already recorded as ${hit.key}`,
      { key: hit.key },
    );
  return null;
}

/** Links or a cross-currency payment: once either exists the money facts are written (US1-8). */
export async function isOpen(tx: TransactionClient, id: string): Promise<boolean> {
  const row = await tx.supplierInvoice.findUnique({ where: { id }, select: { paidAmount: true } });
  if (!row || row.paidAmount) return false;
  const links = await tx.link.count({
    where: { kind: "justifies", toType: "supplier_invoice", toId: id },
  });
  return links === 0;
}
