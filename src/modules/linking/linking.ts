// Linking service — the only writer of the `links` table (constitution §2, D18).
// Invariants enforced here (and in the database where it can): endpoints exist in the caller's tenant,
// the kind accepts the pair, allocations never exceed the target's amount, every change is audited.
import type { Link } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { canAllocate, remaining, sumAllocations } from "./allocation";
import { ALLOCATING_KINDS, isKindAllowed } from "./kinds";
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
    allocatedAmount: row.allocatedAmount ? row.allocatedAmount.toString() : null,
    currency: row.currency,
    note: row.note,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

function violation(message: string): AppError {
  return { code: "BUSINESS_RULE_VIOLATION", message, retryable: false };
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
  const rows = await tx.link.findMany({
    where: { toType: endpoint.type, toId: endpoint.id, allocatedAmount: { not: null } },
    select: { allocatedAmount: true },
  });
  const allocations = rows.map((r) => r.allocatedAmount as Prisma.Decimal);
  return {
    data: {
      endpoint,
      amount: summary.amount,
      currency: summary.currency,
      allocated: sumAllocations(allocations).toFixed(2),
      remaining: remaining(summary.amount, allocations).toFixed(2),
    },
  };
}

// --- Writes ---

export async function createLink(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: CreateLinkInput,
): Promise<ServiceResult<LinkDto>> {
  const { from, to, kind } = input;

  if (from.type === to.type && from.id === to.id)
    return { error: violation("An entity cannot link to itself") };
  if (!isKindAllowed(kind, from.type, to.type)) {
    return { error: violation(`Link kind '${kind}' does not accept ${from.type} → ${to.type}`) };
  }

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

  // Allocation rules: only allocating kinds may carry an amount; it must fit the target's remaining amount.
  let allocatedAmount: Prisma.Decimal | null = null;
  let currency: string | null = null;
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
    throw error;
  }
}

export async function removeLink(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ removed: true }>> {
  const row = await tx.link.findUnique({ where: { id } });
  if (!row)
    return { error: { code: "NOT_FOUND", message: `Link not found: ${id}`, retryable: false } };
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
    note: dto.note,
  };
}
