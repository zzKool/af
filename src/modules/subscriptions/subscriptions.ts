// The subscription service (F94 FR-001 … FR-003, FR-011, US1, US5): describe once, change prices, pause, end.
// Expectations only — nothing here writes a money fact; every reference is validated through its owner's index.
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { Subscription, SubscriptionPause, SubscriptionPrice } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { addDays } from "@/kernel/clock/calendar";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { type AppError, RollbackError, type ServiceResult } from "@/kernel/errors/app-error";
import { CURRENCIES } from "@/kernel/nav/constants";
import { basCode, isoDate, positiveMoney, uuid } from "@/kernel/validation/scalars";
import * as expenses from "@/modules/expenses";
import * as linking from "@/modules/linking";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import * as supplierInvoices from "@/modules/supplier-invoices";
import { attribute } from "./attribution";
import { invalid, notFound, violation } from "./errors";
import { periodsOf } from "./periods";
import type { PauseDto, PriceDto, SubscriptionDto } from "./types";

const D = Prisma.Decimal;
const day = (d: Date) => d.toISOString().slice(0, 10);
const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// --- mappers ---

export function toSubscriptionDto(r: Subscription): SubscriptionDto {
  return {
    id: r.id,
    name: r.name,
    partnerId: r.partnerId,
    becomes: r.becomes,
    basCode: r.basCode,
    groupId: r.groupId,
    paymentSourceId: r.paymentSourceId,
    vatRegistrationId: r.vatRegistrationId,
    cadence: r.cadence,
    startDate: day(r.startDate),
    endDate: r.endDate ? day(r.endDate) : null,
    matchText: r.matchText,
    tolerancePct: r.tolerancePct.toFixed(2),
    note: r.note,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toPriceDto(r: SubscriptionPrice): PriceDto {
  return {
    id: r.id,
    validFrom: day(r.validFrom),
    validTo: r.validTo ? day(r.validTo) : null,
    amount: r.amount.toFixed(2),
    currency: r.currency,
  };
}

export function toPauseDto(r: SubscriptionPause): PauseDto {
  return { id: r.id, fromDate: day(r.fromDate), toDate: day(r.toDate), note: r.note };
}

// --- schemas ---

const tolerance = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, "Use a percentage with up to 2 decimals")
  .refine((v) => Number(v) <= 50, "The tolerance is at most 50 %");
const currency = z.enum(CURRENCIES);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const subscriptionInputSchema = z
  .object({
    name: z.string().trim().min(1, "A name is required").max(120),
    partnerId: uuid,
    becomes: z.enum(["expense", "supplier_invoice"]),
    basCode,
    /** an existing group … */
    groupId: uuid.optional(),
    /** … or a new batch group created with the subscription (Q2 B: one group per subscription by default) */
    newGroup: z.object({ description: z.string().trim().min(1).max(200) }).optional(),
    paymentSourceId: uuid,
    vatRegistrationId: uuid.nullable().optional(),
    cadence: z.enum(["monthly", "yearly"]),
    startDate: isoDate,
    endDate: isoDate.nullable().optional(),
    matchText: optionalText(100),
    tolerancePct: tolerance.optional(),
    note: optionalText(500),
    /** the first price, valid from the start date */
    price: z.object({ amount: positiveMoney, currency }),
  })
  .refine((v) => (v.groupId ? !v.newGroup : !!v.newGroup), {
    message: "Pick a group or create one",
    path: ["groupId"],
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "The end date is on or after the start date",
    path: ["endDate"],
  });
export type SubscriptionInput = z.input<typeof subscriptionInputSchema>;

/** The facts that change for future confirms only (US5-5); becomes, cadence and start are the subscription itself. */
export const updateSubscriptionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  partnerId: uuid.optional(),
  basCode: basCode.optional(),
  groupId: uuid.optional(),
  paymentSourceId: uuid.optional(),
  vatRegistrationId: uuid.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  matchText: optionalText(100),
  tolerancePct: tolerance.optional(),
  note: optionalText(500),
});
export type UpdateSubscriptionInput = z.input<typeof updateSubscriptionSchema>;

export const priceInputSchema = z.object({
  subscriptionId: uuid,
  validFrom: isoDate,
  amount: positiveMoney,
  currency,
});
export const pauseInputSchema = z
  .object({
    subscriptionId: uuid,
    fromDate: isoDate,
    toDate: isoDate,
    note: z.string().trim().min(1, "Say why it is paused").max(500),
  })
  .refine((v) => v.toDate >= v.fromDate, {
    message: "The pause ends on or after it starts",
    path: ["toDate"],
  });

// --- validation through the owners ---

type Refs = {
  partnerId: string;
  becomes: "expense" | "supplier_invoice";
  basCode: string;
  groupId?: string;
  paymentSourceId: string;
  vatRegistrationId?: string | null;
};

async function checkRefs(tx: TransactionClient, v: Refs): Promise<AppError | null> {
  const partner = await partners.getPartner(tx, v.partnerId);
  if (partner.error || !partner.data.isActive) return violation("Unknown or inactive partner");
  if (!partner.data.types.includes("vendor")) return violation("Pick a vendor");
  if (!(await settings.isBasActivated(tx, v.basCode)))
    return violation(`BAS ${v.basCode} is not active for this company`);
  // the expense / supplier invoice key needs the category's short code (`Ex{group}-{alias}-{seq}`): say it now
  if (!(await settings.basAlias(tx, v.basCode)))
    return violation(
      `Category ${v.basCode} has no short code — set one under Settings → BAS categories`,
    );
  if (v.groupId) {
    const group = await expenses.getGroup(tx, v.groupId);
    if (group.error) return notFound("Expense group", v.groupId);
  }
  const source = await expenses.getPaymentSource(tx, v.paymentSourceId);
  if (!source || !source.isActive) return violation("Unknown or inactive payment source");
  if (v.becomes === "supplier_invoice" && source.kind !== "bank_account")
    return violation("A supplier invoice is paid from a company account");
  if (v.vatRegistrationId) {
    const reg = await settings.getVatRegistration(tx, v.vatRegistrationId);
    if (!reg) return notFound("VAT registration", v.vatRegistrationId);
  }
  return null;
}

async function nameTaken(tx: TransactionClient, name: string, exceptId?: string) {
  const hit = await tx.subscription.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return hit !== null;
}

// --- writes ---

export async function createSubscription(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: SubscriptionInput,
): Promise<ServiceResult<SubscriptionDto>> {
  const parsed = subscriptionInputSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;
  const bad = await checkRefs(tx, v);
  if (bad) return { error: bad };
  if (await nameTaken(tx, v.name))
    return { error: violation(`A subscription named ${v.name} exists`) };

  let groupId = v.groupId;
  if (v.newGroup) {
    const g = await expenses.createGroup(tx, caller, audit, {
      description: v.newGroup.description,
      kind: "batch",
    });
    if (g.error) return { error: g.error };
    groupId = g.data.id;
  }
  const row = await tx.subscription.create({
    data: {
      tenantId: caller.tenantId,
      name: v.name,
      partnerId: v.partnerId,
      becomes: v.becomes,
      basCode: v.basCode,
      groupId: groupId as string,
      paymentSourceId: v.paymentSourceId,
      vatRegistrationId: v.vatRegistrationId ?? null,
      cadence: v.cadence,
      startDate: at(v.startDate),
      endDate: v.endDate ? at(v.endDate) : null,
      matchText: v.matchText || null,
      tolerancePct: new D(v.tolerancePct ?? "5"),
      note: v.note || null,
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await tx.subscriptionPrice.create({
    data: {
      tenantId: caller.tenantId,
      subscriptionId: row.id,
      validFrom: at(v.startDate),
      amount: new D(v.price.amount),
      currency: v.price.currency,
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "subscription",
    entityId: row.id,
    newData: { ...toAuditData(row), price: v.price },
  });
  return { data: toSubscriptionDto(row) };
}

export async function updateSubscription(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  input: UpdateSubscriptionInput,
): Promise<ServiceResult<SubscriptionDto>> {
  const parsed = updateSubscriptionSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;
  const row = await tx.subscription.findUnique({ where: { id } });
  if (!row) return { error: notFound("Subscription", id) };
  const next = {
    partnerId: v.partnerId ?? row.partnerId,
    becomes: row.becomes,
    basCode: v.basCode ?? row.basCode,
    groupId: v.groupId ?? row.groupId,
    paymentSourceId: v.paymentSourceId ?? row.paymentSourceId,
    vatRegistrationId:
      v.vatRegistrationId === undefined ? row.vatRegistrationId : v.vatRegistrationId,
  };
  const bad = await checkRefs(tx, next);
  if (bad) return { error: bad };
  if (v.name && (await nameTaken(tx, v.name, id)))
    return { error: violation(`A subscription named ${v.name} exists`) };
  const endDate = v.endDate === undefined ? row.endDate : v.endDate ? at(v.endDate) : null;
  if (endDate && endDate < row.startDate)
    return { error: invalid("The end date is on or after the start date") };
  const updated = await tx.subscription.update({
    where: { id },
    data: {
      ...(v.name !== undefined ? { name: v.name } : {}),
      partnerId: next.partnerId,
      basCode: next.basCode,
      groupId: next.groupId,
      paymentSourceId: next.paymentSourceId,
      vatRegistrationId: next.vatRegistrationId,
      endDate,
      ...(v.matchText !== undefined ? { matchText: v.matchText || null } : {}),
      ...(v.tolerancePct !== undefined ? { tolerancePct: new D(v.tolerancePct) } : {}),
      ...(v.note !== undefined ? { note: v.note || null } : {}),
    },
  });
  await audit.log({
    action: "update",
    entityType: "subscription",
    entityId: id,
    oldData: toAuditData(row),
    newData: toAuditData(updated),
  });
  return { data: toSubscriptionDto(updated) };
}

/** The entities attributed to the subscription — through linking, never `tx.link`. */
export async function occurrenceIds(
  tx: TransactionClient,
  subscriptionIds: readonly string[],
): Promise<{ type: "expense" | "supplier_invoice"; id: string; subscriptionId: string }[]> {
  const links = await linking.linksTouching(tx, "subscription", subscriptionIds, {
    kinds: ["occurrence_of"],
  });
  return links.flatMap((l) =>
    l.to.type === "subscription" &&
    (l.from.type === "expense" || l.from.type === "supplier_invoice")
      ? [{ type: l.from.type, id: l.from.id, subscriptionId: l.to.id }]
      : [],
  );
}

/** Refused once anything is attributed (*End it instead*, US5-6); otherwise gone with its prices and pauses. */
export async function deleteSubscription(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: true }>> {
  const row = await tx.subscription.findUnique({ where: { id } });
  if (!row) return { error: notFound("Subscription", id) };
  if ((await occurrenceIds(tx, [id])).length > 0)
    return {
      error: violation(`${row.name} has periods with an expense or invoice — end it instead`),
    };
  await tx.subscription.delete({ where: { id } });
  await audit.log({
    action: "delete",
    entityType: "subscription",
    entityId: id,
    oldData: toAuditData(row),
  });
  return { data: { deleted: true } };
}

/**
 * A new price from a date (US5-1, the contract-rate rule): the price covering the day before closes on
 * `validFrom − 1`; a price starting on or after `validFrom` refuses (no rewriting the history).
 */
export async function addPrice(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: z.input<typeof priceInputSchema>,
): Promise<ServiceResult<PriceDto>> {
  const parsed = priceInputSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;
  const sub = await tx.subscription.findUnique({ where: { id: v.subscriptionId } });
  if (!sub) return { error: notFound("Subscription", v.subscriptionId) };
  if (v.validFrom <= day(sub.startDate))
    return { error: violation("A new price starts after the subscription's start") };
  const prices = (await tx.subscriptionPrice.findMany({ where: { subscriptionId: sub.id } })).map(
    toPriceDto,
  );
  if (prices.some((p) => p.validFrom >= v.validFrom))
    return { error: violation("A price already starts on or after that day") };
  const open = prices.find((p) => p.validTo === null || p.validTo >= v.validFrom);
  if (open) {
    await tx.subscriptionPrice.update({
      where: { id: open.id },
      data: { validTo: at(addDays(v.validFrom, -1)) },
    });
  }
  const row = await tx.subscriptionPrice.create({
    data: {
      tenantId: caller.tenantId,
      subscriptionId: sub.id,
      validFrom: at(v.validFrom),
      amount: new D(v.amount),
      currency: v.currency,
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "subscription_price",
    entityId: row.id,
    newData: { ...toAuditData(row), closed: open?.id ?? null },
  });
  return { data: toPriceDto(row) };
}

/** Remove the latest price (never the only one); the one before it is open again. */
export async function removePrice(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: true }>> {
  const row = await tx.subscriptionPrice.findUnique({ where: { id } });
  if (!row) return { error: notFound("Price", id) };
  const all = await tx.subscriptionPrice.findMany({
    where: { subscriptionId: row.subscriptionId },
    orderBy: { validFrom: "desc" },
  });
  if (all.length === 1) return { error: violation("A subscription keeps at least one price") };
  if (all[0]?.id !== id) return { error: violation("Only the latest price can be removed") };
  await tx.subscriptionPrice.delete({ where: { id } });
  const previous = all[1];
  if (previous) {
    await tx.subscriptionPrice.update({ where: { id: previous.id }, data: { validTo: null } });
  }
  await audit.log({
    action: "delete",
    entityType: "subscription_price",
    entityId: id,
    oldData: toAuditData(row),
  });
  return { data: { deleted: true } };
}

/** A pause (US5-3): the periods expected in it are skipped; refused over a period that already has an entity. */
export async function addPause(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: z.input<typeof pauseInputSchema>,
  today: string,
): Promise<ServiceResult<PauseDto>> {
  const parsed = pauseInputSchema.safeParse(input);
  if (!parsed.success)
    return { error: invalid(parsed.error.issues[0]?.message ?? "Invalid input") };
  const v = parsed.data;
  const sub = await tx.subscription.findUnique({ where: { id: v.subscriptionId } });
  if (!sub) return { error: notFound("Subscription", v.subscriptionId) };
  const occurrences = await occurrenceIds(tx, [sub.id]);
  if (occurrences.length > 0) {
    const dto = toSubscriptionDto(sub);
    const periods = periodsOf(
      { ...dto, prices: [], pauses: [] },
      v.toDate > today ? v.toDate : today,
    );
    const dated = await entityDates(tx, occurrences);
    const byPeriod = attribute(
      periods.map((p) => p.date),
      dated,
    );
    for (const [i, list] of byPeriod) {
      const date = periods[i]?.date;
      if (date && date >= v.fromDate && date <= v.toDate && list.length > 0)
        return {
          error: violation(`The period of ${date} already has ${list[0]?.key ?? "an entity"}`),
        };
    }
  }
  const row = await tx.subscriptionPause.create({
    data: {
      tenantId: caller.tenantId,
      subscriptionId: sub.id,
      fromDate: at(v.fromDate),
      toDate: at(v.toDate),
      note: v.note,
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "subscription_pause",
    entityId: row.id,
    newData: toAuditData(row),
  });
  return { data: toPauseDto(row) };
}

export async function removePause(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: true }>> {
  const row = await tx.subscriptionPause.findUnique({ where: { id } });
  if (!row) return { error: notFound("Pause", id) };
  await tx.subscriptionPause.delete({ where: { id } });
  await audit.log({
    action: "delete",
    entityType: "subscription_pause",
    entityId: id,
    oldData: toAuditData(row),
  });
  return { data: { deleted: true } };
}

/** The dates and keys of attributed entities, through their modules (for the pause guard). */
export async function entityDates(
  tx: TransactionClient,
  occurrences: readonly { type: "expense" | "supplier_invoice"; id: string }[],
): Promise<{ id: string; date: string; key: string }[]> {
  const exp = await expenses.expenseRowsByIds(
    tx,
    occurrences.filter((o) => o.type === "expense").map((o) => o.id),
  );
  const sis = await supplierInvoices.supplierInvoiceRowsByIds(
    tx,
    occurrences.filter((o) => o.type === "supplier_invoice").map((o) => o.id),
  );
  return [
    ...exp.map((e) => ({ id: e.id, date: e.date, key: e.key })),
    ...sis.map((s) => ({ id: s.id, date: s.invoiceDate, key: s.key })),
  ];
}

/**
 * *Make it recurring* (FR-011, US1-5): a subscription created from an existing expense / supplier invoice, which is
 * attributed to it at once (`occurrence_of` through linking).
 */
export async function makeRecurring(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: {
    entity: { type: "expense" | "supplier_invoice"; id: string };
    subscription: SubscriptionInput;
  },
): Promise<ServiceResult<SubscriptionDto>> {
  const created = await createSubscription(tx, caller, audit, input.subscription);
  if (created.error) return created;
  const link = await linking.createLink(tx, caller, audit, {
    from: input.entity,
    to: { type: "subscription", id: created.data.id },
    kind: "occurrence_of",
  });
  if (link.error) throw new RollbackError(link.error);
  return created;
}

/** *Detach* (FR-005): remove an entity's `occurrence_of` this subscription — through linking; the entity stays. */
export async function detachOccurrence(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { subscriptionId: string; entity: { type: "expense" | "supplier_invoice"; id: string } },
): Promise<ServiceResult<{ detached: true }>> {
  const links = await linking.linksTouching(tx, "subscription", [input.subscriptionId], {
    kinds: ["occurrence_of"],
  });
  const link = links.find(
    (l) => l.from.type === input.entity.type && l.from.id === input.entity.id,
  );
  if (!link) return { error: notFound("Occurrence", input.entity.id) };
  const removed = await linking.removeLink(tx, caller, audit, link.id);
  if (removed.error) return { error: removed.error };
  return { data: { detached: true } };
}
