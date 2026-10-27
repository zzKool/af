// Linking service — the only writer of the `links` table (constitution §2, D18).
// Invariants enforced here (and in the database where it can): endpoints exist in the caller's tenant,
// the kind accepts the pair, allocations never exceed the target's amount nor the row's base, every change is
// audited. F114 (D60): an allocating link IS the payment record — `allocated_amount` in the target's currency,
// `allocated_base` what the bank row gave; the trigger `links_check_allocation` keeps both sums as the service does.
import type { Link } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { sliceBase } from "@/kernel/money/settlement";
import { canAllocate, remaining, sumAllocations } from "./allocation";
import {
  ALLOCATING_KINDS,
  EXCLUSIVE_KINDS,
  EXCLUSIVE_SIDES,
  isKindAllowed,
  needsOwnFlow,
} from "./kinds";
import { getLinkable } from "./linkable";
import type {
  AllocationStatus,
  CreateLinkInput,
  LinkableType,
  LinkDto,
  LinkEndpoint,
  LinkKind,
} from "./types";

// --- DTO mapping (Prisma rows never leave the module) ---

export function toLinkDto(row: Link): LinkDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    from: { type: row.fromType as LinkableType, id: row.fromId },
    to: { type: row.toType as LinkableType, id: row.toId },
    kind: row.kind as LinkKind,
    allocatedAmount: row.allocatedAmount ? row.allocatedAmount.toFixed(2) : null,
    currency: row.currency,
    allocatedBase: row.allocatedBase ? row.allocatedBase.toFixed(2) : null,
    note: row.note,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

function violation(message: string): AppError {
  return { code: "BUSINESS_RULE_VIOLATION", message, retryable: false };
}

/** Who writes the link: the owning module of the `to` entity, for the kinds it owns (D37, F58). */
export type LinkWriteOptions = { owner?: LinkableType };

const OWN_FLOW_MESSAGE: Partial<Record<LinkableType, string>> = {
  expense: "An expense's bank row is attached and detached from the expense's own panel (D37)",
  supplier_invoice:
    "A supplier invoice's payments are recorded and removed from the invoice's own panel (D37)",
};

/** The refusal of a generic `justifies` onto an entity that writes its own payments; null when allowed. */
function ownFlowRefusal(kind: LinkKind, to: LinkableType, opts: LinkWriteOptions): AppError | null {
  if (!needsOwnFlow(kind, to) || opts.owner === to) return null;
  return {
    code: "BUSINESS_RULE_VIOLATION",
    message: OWN_FLOW_MESSAGE[to] ?? `${to} writes its own payments`,
    retryable: false,
    details: { ownFlow: to },
  };
}

function endpointWhere(e: LinkEndpoint) {
  return {
    OR: [
      { fromType: e.type, fromId: e.id },
      { toType: e.type, toId: e.id },
    ],
  };
}

// --- Reads ---

export async function getLinksFor(
  tx: TransactionClient,
  endpoint: LinkEndpoint,
): Promise<ServiceResult<LinkDto[]>> {
  const rows = await tx.link.findMany({
    where: endpointWhere(endpoint),
    orderBy: { createdAt: "asc" },
  });
  return { data: rows.map(toLinkDto) };
}

export async function isLinked(tx: TransactionClient, endpoint: LinkEndpoint): Promise<boolean> {
  const n = await tx.link.count({ where: endpointWhere(endpoint) });
  return n > 0;
}

/** Amount, allocated and remaining for an entity that carries an amount; null when it carries none. */
export async function getAllocationStatus(
  tx: TransactionClient,
  endpoint: LinkEndpoint,
): Promise<ServiceResult<AllocationStatus | null>> {
  const linkable = getLinkable(endpoint.type);
  if (!linkable) return { error: violation(`Unknown linkable type: ${endpoint.type}`) };
  const summary = await linkable.summary(tx, endpoint.id);
  if (!summary) {
    return {
      error: {
        code: "NOT_FOUND",
        message: `${endpoint.type} ${endpoint.id} not found`,
        retryable: false,
      },
    };
  }
  if (summary.amount === null || summary.currency === null) return { data: null };
  // a bank row allocates FROM itself; everything else is allocated TO
  const side =
    endpoint.type === "bank_transaction"
      ? { fromType: endpoint.type, fromId: endpoint.id }
      : { toType: endpoint.type, toId: endpoint.id };
  const rows = await tx.link.findMany({
    where: { ...side, allocatedAmount: { not: null } },
    select: { allocatedAmount: true, allocatedBase: true, currency: true },
  });
  const allocations = rows
    .filter((r) => r.currency === summary.currency)
    .map((r) => r.allocatedAmount as Prisma.Decimal);
  const bases = rows.map((r) => r.allocatedBase ?? new Prisma.Decimal(0));
  return {
    data: {
      endpoint,
      amount: summary.amount,
      currency: summary.currency,
      allocated: sumAllocations(allocations).toFixed(2),
      remaining: remaining(summary.amount, allocations).toFixed(2),
      allocatedBase: sumAllocations(bases).toFixed(2),
    },
  };
}

// --- Writes ---

export async function createLink(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: CreateLinkInput,
  opts: LinkWriteOptions = {},
): Promise<ServiceResult<LinkDto>> {
  const { from, to, kind } = input;

  if (from.type === to.type && from.id === to.id)
    return { error: violation("An entity cannot link to itself") };
  if (!isKindAllowed(kind, from.type, to.type)) {
    return { error: violation(`Link kind '${kind}' does not accept ${from.type} → ${to.type}`) };
  }
  const refused = ownFlowRefusal(kind, to.type, opts);
  if (refused) return { error: refused };

  // Pre-check the unique tuple: a constraint violation would abort the surrounding Postgres transaction.
  const duplicate = await tx.link.findFirst({
    where: { fromType: from.type, fromId: from.id, toType: to.type, toId: to.id, kind },
    select: { id: true },
  });
  if (duplicate) {
    return {
      error: { code: "DUPLICATE_ENTRY", message: "This link already exists", retryable: false },
    };
  }

  // Exclusive kinds: a document becomes one thing, an entity has one origin (created_from, both sides); an entity is
  // the period of one subscription (occurrence_of, the entity's side). Pre-checked for a clean error; the partial
  // unique indexes enforce it regardless.
  if (EXCLUSIVE_KINDS.includes(kind)) {
    const taken = await tx.link.findFirst({
      where: {
        kind,
        OR: [
          { fromType: from.type, fromId: from.id },
          ...(EXCLUSIVE_SIDES[kind] === "from" ? [] : [{ toType: to.type, toId: to.id }]),
        ],
      },
      select: { fromType: true, fromId: true, toType: true, toId: true },
    });
    if (taken) {
      const side =
        kind === "occurrence_of"
          ? `${from.type} ${from.id} is already a period of ${taken.toType} ${taken.toId}`
          : taken.toType === to.type && taken.toId === to.id
            ? `${to.type} ${to.id} already became ${taken.fromType} ${taken.fromId}`
            : `${from.type} ${from.id} was already created from ${taken.toType} ${taken.toId}`;
      return { error: violation(side) };
    }
  }

  const fromLinkable = getLinkable(from.type);
  const toLinkable = getLinkable(to.type);
  if (!fromLinkable || !toLinkable) {
    return { error: violation(`Unknown linkable type: ${!fromLinkable ? from.type : to.type}`) };
  }
  if (!(await fromLinkable.exists(tx, from.id))) {
    return {
      error: { code: "NOT_FOUND", message: `${from.type} ${from.id} not found`, retryable: false },
    };
  }
  const toSummary = await toLinkable.summary(tx, to.id);
  if (!toSummary) {
    return {
      error: { code: "NOT_FOUND", message: `${to.type} ${to.id} not found`, retryable: false },
    };
  }

  // Allocation rules (F114, D60): only allocating kinds carry an amount; the amount is in the target's currency and
  // fits what is still open on it; the base the row gives — pro rata of the row's base, the whole remaining base
  // when the currencies differ, or as stated — fits what is left of the row's base. The trigger says the same.
  let allocatedAmount: Prisma.Decimal | null = null;
  let currency: string | null = null;
  let allocatedBase: Prisma.Decimal | null = null;
  if (input.allocatedAmount != null) {
    if (!ALLOCATING_KINDS.includes(kind)) {
      return { error: violation(`Link kind '${kind}' does not carry an allocation`) };
    }
    if (toSummary.amount === null || toSummary.currency === null) {
      return { error: violation(`${to.type} ${to.id} carries no amount to allocate against`) };
    }
    currency = input.currency ?? toSummary.currency;
    if (currency !== toSummary.currency) {
      return {
        error: violation(
          `Allocation currency ${currency} differs from ${to.type} currency ${toSummary.currency}`,
        ),
      };
    }
    const existing = await tx.link.findMany({
      where: { toType: to.type, toId: to.id, allocatedAmount: { not: null } },
      select: { allocatedAmount: true },
    });
    const allocations = existing.map((r) => r.allocatedAmount as Prisma.Decimal);
    if (!canAllocate(toSummary.amount, allocations, input.allocatedAmount)) {
      return {
        error: violation(
          `Allocation ${input.allocatedAmount} exceeds the remaining ${remaining(toSummary.amount, allocations).toFixed(2)} ${toSummary.currency} on ${to.type} ${to.id}`,
        ),
      };
    }
    allocatedAmount = new Prisma.Decimal(input.allocatedAmount);
    // The source side: a bank row gives base. Its links so far, whatever their currency, say what is left of it.
    const fromSummary = await fromLinkable.summary(tx, from.id);
    if (
      fromSummary?.amount !== null &&
      fromSummary?.amount !== undefined &&
      fromSummary.currency &&
      fromSummary.amountBase != null
    ) {
      const fromExisting = await tx.link.findMany({
        where: { fromType: from.type, fromId: from.id, allocatedAmount: { not: null } },
        select: { allocatedAmount: true, allocatedBase: true, currency: true },
      });
      const givenBase = sumAllocations(
        fromExisting.map((r) => r.allocatedBase ?? new Prisma.Decimal(0)),
      );
      const remainingBase = new Prisma.Decimal(fromSummary.amountBase).abs().minus(givenBase);
      const sameCurrency = currency === fromSummary.currency;
      if (input.allocatedBase != null) {
        allocatedBase = new Prisma.Decimal(input.allocatedBase);
      } else if (sameCurrency) {
        const givenAmount = sumAllocations(
          fromExisting
            .filter((r) => r.currency === fromSummary.currency)
            .map((r) => r.allocatedAmount as Prisma.Decimal),
        );
        if (!canAllocate(fromSummary.amount, [givenAmount], allocatedAmount)) {
          return {
            error: violation(
              `Allocations from ${from.type} ${from.id} (${givenAmount.toFixed(2)} of ${fromSummary.amount} ${fromSummary.currency}) would exceed its amount`,
            ),
          };
        }
        allocatedBase = sliceBase(
          { amount: fromSummary.amount, amountBase: fromSummary.amountBase },
          { amount: givenAmount, base: givenBase },
          allocatedAmount,
        );
      } else {
        allocatedBase = remainingBase;
      }
      if (allocatedBase.lte(0) || allocatedBase.gt(remainingBase)) {
        return {
          error: violation(
            `The base ${allocatedBase.toFixed(2)} exceeds what is left of ${from.type} ${from.id}'s base (${remainingBase.toFixed(2)})`,
          ),
        };
      }
    } else if (input.allocatedBase != null) {
      allocatedBase = new Prisma.Decimal(input.allocatedBase);
    } else {
      return { error: violation(`${from.type} ${from.id} carries no base to allocate from`) };
    }
  }

  try {
    const row = await tx.link.create({
      data: {
        tenantId: caller.tenantId,
        fromType: from.type,
        fromId: from.id,
        toType: to.type,
        toId: to.id,
        kind,
        allocatedAmount,
        currency,
        allocatedBase,
        note: input.note ?? null,
        createdBy: caller.userId,
        source: caller.source,
      },
    });
    const dto = toLinkDto(row);
    await audit.log({
      action: "create",
      entityType: "link",
      entityId: row.id,
      newData: linkAuditData(dto),
    });
    return { data: dto };
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return {
        error: { code: "DUPLICATE_ENTRY", message: "This link already exists", retryable: false },
      };
    }
    const detail = triggerDetail(error, "link_allocation_exceeded");
    if (detail) return { error: violation(detail) };
    throw error;
  }
}

/** The DETAIL of a Postgres trigger refusal (`RAISE EXCEPTION '<name>' USING DETAIL`), or null for any other error. */
export function triggerDetail(error: unknown, name: string): string | null {
  if (!error || typeof error !== "object") return null;
  const text = String((error as { message?: unknown }).message ?? "");
  if (!text.includes(name)) return null;
  const meta = (error as { meta?: { message?: unknown } }).meta?.message;
  const metaText = typeof meta === "string" ? meta : text;
  const m = metaText.match(/DETAIL:\s*([^\n]+)/);
  return m ? m[1].trim() : name;
}

export async function removeLink(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  opts: LinkWriteOptions = {},
): Promise<ServiceResult<{ removed: true }>> {
  const row = await tx.link.findUnique({ where: { id } });
  if (!row)
    return { error: { code: "NOT_FOUND", message: `Link not found: ${id}`, retryable: false } };
  // removing an attach-made link here would leave the paid amount and the bank base on the entity (audit 4)
  const refused = ownFlowRefusal(row.kind as LinkKind, row.toType as LinkableType, opts);
  if (refused) return { error: refused };
  await tx.link.delete({ where: { id } });
  await audit.log({
    action: "delete",
    entityType: "link",
    entityId: id,
    oldData: linkAuditData(toLinkDto(row)),
  });
  return { data: { removed: true } };
}

function linkAuditData(dto: LinkDto): Record<string, unknown> {
  return {
    fromType: dto.from.type,
    fromId: dto.from.id,
    toType: dto.to.type,
    toId: dto.to.id,
    kind: dto.kind,
    allocatedAmount: dto.allocatedAmount,
    currency: dto.currency,
    allocatedBase: dto.allocatedBase,
    note: dto.note,
  };
}
