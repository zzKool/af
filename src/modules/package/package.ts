// The build service (spec FR-001, FR-005): request a build (one row, versioned per period), then the job's three
// state changes — building, built (with the stored zip, the counts and notes), failed (with the reason, nothing
// stored). Owner only; audited. Never imports next/* or components.
import { z } from "zod/v4";
import type { PackageBuild } from "@/generated/prisma/client";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { packageKey } from "@/modules/numbering";
import { isPackagePeriod } from "./period";
import type { PackageBuildDto, PackageCounts } from "./types";

export const EMPTY_COUNTS: PackageCounts = {
  bankRows: 0,
  invoices: 0,
  supplierInvoices: 0,
  expenses: 0,
  settlements: 0,
  documents: 0,
};

export const buildRequestSchema = z.object({
  period: z.string().refine(isPackagePeriod, "Expected YYYY-MM or YYYY"),
});
export type BuildRequest = z.infer<typeof buildRequestSchema>;

export function toBuildDto(row: PackageBuild): PackageBuildDto {
  const counts = (row.counts ?? {}) as Partial<PackageCounts>;
  return {
    id: row.id,
    tenantId: row.tenantId,
    period: row.period,
    version: row.version,
    // the Postgres enum: a member the DTO list lacks fails to compile here (the other way: state-family.pure.test.ts)
    status: row.status,
    documentId: row.documentId,
    businessKey: row.businessKey,
    counts: { ...EMPTY_COUNTS, ...counts },
    flags: row.flags,
    notes: row.notes,
    error: row.error,
    builtAt: row.builtAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

const forbidden = {
  error: {
    code: "FORBIDDEN" as const,
    message: "Only the owner builds packages",
    retryable: false,
  },
};

/** A new build of the period: version max + 1, `Package_<period>[_vN].zip`; refused while one is already running. */
export async function requestBuild(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: BuildRequest,
): Promise<ServiceResult<PackageBuildDto>> {
  if (!can(caller, "create", "accountant_package")) return forbidden;
  const parsed = buildRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: { code: "VALIDATION_ERROR", message: parsed.error.message, retryable: false },
    };
  }
  const { period } = parsed.data;
  const running = await tx.packageBuild.findFirst({
    where: { period, status: { in: ["queued", "building"] } },
    select: { id: true, version: true },
  });
  if (running) {
    return {
      error: {
        code: "BUSINESS_RULE_VIOLATION",
        message: `A build of ${period} is already running (v${running.version})`,
        retryable: true,
      },
    };
  }
  const last = await tx.packageBuild.aggregate({ where: { period }, _max: { version: true } });
  const version = (last._max.version ?? 0) + 1;
  const row = await tx.packageBuild.create({
    data: {
      tenantId: caller.tenantId,
      period,
      version,
      status: "queued",
      businessKey: packageKey(period, version),
      createdBy: caller.userId,
      source: caller.source,
    },
  });
  await audit.log({
    action: "create",
    entityType: "package_build",
    entityId: row.id,
    newData: { period, version, businessKey: row.businessKey },
  });
  return { data: toBuildDto(row) };
}

export async function getBuild(tx: TransactionClient, id: string): Promise<PackageBuildDto | null> {
  const row = await tx.packageBuild.findUnique({ where: { id } });
  return row ? toBuildDto(row) : null;
}

/** queued → building (idempotent: a retry of a building build goes on). Null when the build is gone or finished. */
export async function markBuilding(
  tx: TransactionClient,
  id: string,
): Promise<PackageBuildDto | null> {
  const row = await tx.packageBuild.findUnique({ where: { id } });
  if (!row || (row.status !== "queued" && row.status !== "building")) return null;
  const updated = await tx.packageBuild.update({ where: { id }, data: { status: "building" } });
  return toBuildDto(updated);
}

export async function markBuilt(
  tx: TransactionClient,
  audit: AuditLogger,
  id: string,
  result: {
    documentId: string;
    counts: PackageCounts;
    flags: number;
    notes: string;
    builtAt: Date;
  },
): Promise<PackageBuildDto> {
  const row = await tx.packageBuild.update({
    where: { id },
    data: {
      status: "built",
      documentId: result.documentId,
      counts: result.counts,
      flags: result.flags,
      notes: result.notes,
      error: null,
      builtAt: result.builtAt,
    },
  });
  await audit.log({
    action: "update",
    entityType: "package_build",
    entityId: id,
    newData: {
      status: "built",
      documentId: result.documentId,
      businessKey: row.businessKey,
      counts: result.counts,
      flags: result.flags,
    },
  });
  return toBuildDto(row);
}

export async function markFailed(
  tx: TransactionClient,
  audit: AuditLogger,
  id: string,
  error: string,
): Promise<void> {
  await tx.packageBuild.update({
    where: { id },
    data: { status: "failed", error: error.slice(0, 2000) },
  });
  await audit.log({
    action: "update",
    entityType: "package_build",
    entityId: id,
    newData: { status: "failed", error: error.slice(0, 500) },
  });
}
