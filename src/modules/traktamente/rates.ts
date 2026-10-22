// The normalbelopp table (specs/traktamente US4, FR-001, FR-004): one row per (year, country), entered by the owner
// — by hand, copied from last year, or pasted from Skatteverket's CSV (`År;Land eller område;Landskod;Normalbelopp`).
// A row a trip relies on is never deleted. MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { Normalbelopp } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { money, positiveMoney } from "@/kernel/validation/scalars";
import type { NormalbeloppDto, RateRow } from "./types";

const D = Prisma.Decimal;

const violation = (message: string): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message,
  retryable: false,
});
const invalid = (message: string): AppError => ({
  code: "VALIDATION_ERROR",
  message,
  retryable: false,
});

const year = z.number().int().min(2000).max(2100);
const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "A country code is two letters");

export const rateInputSchema = z.object({
  year,
  countryCode,
  countryNameSv: z.string().trim().min(1, "The Swedish name is required").max(100),
  countryNameEn: z.string().trim().max(100).nullable().optional(),
  dayAmount: positiveMoney,
  nightAmount: money.nullable().optional(),
  mealBreakfast: money.nullable().optional(),
  mealLunch: money.nullable().optional(),
  mealDinner: money.nullable().optional(),
  mealAll: money.nullable().optional(),
  rateSource: z.string().trim().max(60).optional(),
});
export type RateInput = z.input<typeof rateInputSchema>;

export function toRateDto(row: Normalbelopp): NormalbeloppDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    year: row.year,
    countryCode: row.countryCode,
    countryNameSv: row.countryNameSv,
    countryNameEn: row.countryNameEn,
    dayAmount: row.dayAmount.toFixed(2),
    nightAmount: row.nightAmount ? row.nightAmount.toFixed(2) : null,
    mealBreakfast: row.mealBreakfast ? row.mealBreakfast.toFixed(2) : null,
    mealLunch: row.mealLunch ? row.mealLunch.toFixed(2) : null,
    mealDinner: row.mealDinner ? row.mealDinner.toFixed(2) : null,
    mealAll: row.mealAll ? row.mealAll.toFixed(2) : null,
    rateSource: row.rateSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toRateRow(row: NormalbeloppDto): RateRow {
  return {
    year: row.year,
    countryCode: row.countryCode,
    dayAmount: row.dayAmount,
    nightAmount: row.nightAmount,
    mealBreakfast: row.mealBreakfast,
    mealLunch: row.mealLunch,
    mealDinner: row.mealDinner,
    mealAll: row.mealAll,
  };
}

const dec = (v: string | null | undefined) => (v == null || v === "" ? null : new D(v));

/** Create or update the (year, country) row — audited either way. */
export async function upsertRate(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: RateInput,
): Promise<ServiceResult<NormalbeloppDto>> {
  const parsed = rateInputSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;
  const existing = await tx.normalbelopp.findFirst({
    where: { year: v.year, countryCode: v.countryCode },
  });
  const data = {
    countryNameSv: v.countryNameSv,
    countryNameEn: v.countryNameEn ?? null,
    dayAmount: new D(v.dayAmount),
    nightAmount: dec(v.nightAmount),
    mealBreakfast: dec(v.mealBreakfast),
    mealLunch: dec(v.mealLunch),
    mealDinner: dec(v.mealDinner),
    mealAll: dec(v.mealAll),
    rateSource: v.rateSource ?? "manual",
  };
  if (existing) {
    const row = await tx.normalbelopp.update({ where: { id: existing.id }, data });
    await audit.log({
      action: "update",
      entityType: "normalbelopp",
      entityId: row.id,
      oldData: toAuditData(existing),
      newData: toAuditData(row),
    });
    return { data: toRateDto(row) };
  }
  const row = await tx.normalbelopp.create({
    data: {
      tenantId: caller.tenantId,
      year: v.year,
      countryCode: v.countryCode,
      ...data,
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "normalbelopp",
    entityId: row.id,
    newData: toAuditData(row),
  });
  return { data: toRateDto(row) };
}

/** Refused while a trip to that country touches that year (US4). */
export async function deleteRate(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: true }>> {
  const row = await tx.normalbelopp.findUnique({ where: { id } });
  if (!row)
    return { error: { code: "NOT_FOUND", message: `Rate not found: ${id}`, retryable: false } };
  const from = new Date(Date.UTC(row.year, 0, 1));
  const to = new Date(Date.UTC(row.year + 1, 0, 1));
  const used = await tx.trip.count({
    where: { countryCode: row.countryCode, departureAt: { lt: to }, returnAt: { gte: from } },
  });
  if (used > 0) {
    return {
      error: violation(
        `${row.countryCode} ${row.year} is used by ${used} trip(s) — the rate stays`,
      ),
    };
  }
  await tx.normalbelopp.delete({ where: { id } });
  await audit.log({
    action: "delete",
    entityType: "normalbelopp",
    entityId: id,
    oldData: toAuditData(row),
  });
  return { data: { deleted: true } };
}

/** Every row of `fromYear` that `toYear` lacks, as `copied from {fromYear}`; existing rows untouched (US4-2). */
export async function copyRatesFromYear(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { fromYear: number; toYear: number },
): Promise<ServiceResult<{ copied: number; skipped: number }>> {
  if (input.fromYear === input.toYear) return { error: invalid("Pick two different years") };
  const source = await tx.normalbelopp.findMany({ where: { year: input.fromYear } });
  if (source.length === 0) return { error: violation(`No rates for ${input.fromYear} to copy`) };
  const existing = new Set(
    (
      await tx.normalbelopp.findMany({
        where: { year: input.toYear },
        select: { countryCode: true },
      })
    ).map((r) => r.countryCode),
  );
  let copied = 0;
  for (const r of source) {
    if (existing.has(r.countryCode)) continue;
    const dto = toRateDto(r);
    const res = await upsertRate(tx, caller, audit, {
      ...dto,
      year: input.toYear,
      rateSource: `copied from ${input.fromYear}`,
    });
    if (res.error) return { error: res.error };
    copied += 1;
  }
  return { data: { copied, skipped: source.length - copied } };
}

// --- Skatteverket's CSV ---

export type ParsedRate = {
  year: number;
  countryCode: string;
  countryNameSv: string;
  dayAmount: string;
};
export type ParsedCsv = {
  rows: ParsedRate[];
  /** `Färöarna → Se Danmark` and the like: references, not amounts */
  skipped: { line: number; text: string; reason: string }[];
};

const HEADER = ["år", "land eller område", "landskod", "normalbelopp"];

/**
 * `År;Land eller område;Landskod;Normalbelopp` with a decimal comma; rows whose amount is a reference
 * (`Se Danmark`) or whose country code is empty are skipped and reported. The header may be absent.
 */
export function parseSkatteverketCsv(text: string, defaultYear?: number): ParsedCsv {
  const out: ParsedCsv = { rows: [], skipped: [] };
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cells = line.split(/[;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (
      i === 0 &&
      cells
        .map((c) => c.toLowerCase())
        .join("|")
        .startsWith(HEADER.join("|"))
    )
      return;
    // with or without the year column: `2025;Schweiz;CH;1402` or `Schweiz;CH;1402` (+ the default year)
    const hasYear = /^\d{4}$/.test(cells[0] ?? "");
    const year = hasYear ? Number(cells[0]) : defaultYear;
    const [name, code, amountText] = hasYear ? cells.slice(1) : cells;
    if (!year) {
      out.skipped.push({ line: i + 1, text: line, reason: "no year" });
      return;
    }
    if (!code || !/^[A-Za-z]{2}$/.test(code)) {
      out.skipped.push({ line: i + 1, text: line, reason: "no country code" });
      return;
    }
    const amount = (amountText ?? "").replace(/\s/g, "").replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      out.skipped.push({ line: i + 1, text: line, reason: `not an amount: "${amountText ?? ""}"` });
      return;
    }
    out.rows.push({
      year,
      countryCode: code.toUpperCase(),
      countryNameSv: name ?? code,
      dayAmount: amount,
    });
  });
  return out;
}

export const pasteSchema = z.object({
  text: z.string().min(1).max(200_000),
  year: year.optional(),
  dryRun: z.boolean().optional(),
});
export type PasteInput = z.input<typeof pasteSchema>;

/** Preview (`dryRun`) or upsert the pasted rows; existing meal / night amounts of a row are kept. */
export async function pasteSkatteverketCsv(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: PasteInput,
): Promise<ServiceResult<ParsedCsv & { created: number; updated: number }>> {
  const parsed = pasteSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const result = parseSkatteverketCsv(parsed.data.text, parsed.data.year);
  if (result.rows.length === 0)
    return { error: violation("No rate rows found in the pasted text") };
  let created = 0;
  let updated = 0;
  if (!parsed.data.dryRun) {
    for (const r of result.rows) {
      const existing = await tx.normalbelopp.findFirst({
        where: { year: r.year, countryCode: r.countryCode },
      });
      const res = await upsertRate(tx, caller, audit, {
        ...(existing ? toRateDto(existing) : {}),
        year: r.year,
        countryCode: r.countryCode,
        countryNameSv: r.countryNameSv,
        dayAmount: r.dayAmount,
        rateSource: "skatteverket-csv",
      });
      if (res.error) return { error: res.error };
      if (existing) updated += 1;
      else created += 1;
    }
  }
  return { data: { ...result, created, updated } };
}

// --- reads ---

export async function listRates(tx: TransactionClient, year?: number): Promise<NormalbeloppDto[]> {
  const rows = await tx.normalbelopp.findMany({
    where: year ? { year } : {},
    orderBy: [{ year: "desc" }, { countryNameSv: "asc" }],
  });
  return rows.map(toRateDto);
}

export async function rateYears(tx: TransactionClient): Promise<number[]> {
  const rows = await tx.normalbelopp.findMany({ select: { year: true }, distinct: ["year"] });
  return rows.map((r) => r.year).sort((a, b) => b - a);
}

/** The country's rows for a set of years, keyed by year (what the calculator takes). */
export async function ratesForYears(
  tx: TransactionClient,
  countryCode: string,
  years: readonly number[],
): Promise<Map<number, RateRow>> {
  const rows = await tx.normalbelopp.findMany({
    where: { countryCode: countryCode.toUpperCase(), year: { in: [...years] } },
  });
  return new Map(rows.map((r) => [r.year, toRateRow(toRateDto(r))]));
}
