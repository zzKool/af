import { z } from "zod/v4";
import { DEFAULT_DOCUMENT_TYPE_PREFIXES } from "@/lib/constants";
import type { TransactionClient } from "@/server/db/tenant-client";
import { toAuditData } from "@/server/services/audit";
import type { AppError } from "@/types/app-error";
import type { AuditLogger } from "@/types/audit";
import type { CallerIdentity } from "@/types/caller-identity";

// MUST NOT import from next/* or src/components/*

type ServiceResult<T> = { data: T; error?: never } | { data?: never; error: AppError };

// Prefix validation: lowercase alphanumeric + trailing underscore, max 10 chars
export const prefixSchema = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.string().min(2).max(10).regex(/^[a-z0-9]+_$/, "Prefix must be lowercase alphanumeric ending with _"));

// Document type validation: non-empty, max 30 chars, lowercase alphanumeric + hyphens
export const documentTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(30)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Document type must be lowercase alphanumeric with optional hyphens");

/**
 * Get all document-type prefixes for the tenant (RLS-scoped by middleware).
 * Pure read — no audit param needed.
 */
export async function getDocumentTypePrefixes(
  tx: TransactionClient,
  _caller: CallerIdentity,
): Promise<
  ServiceResult<
    {
      id: string;
      documentType: string;
      prefix: string;
      createdAt: Date;
      updatedAt: Date;
    }[]
  >
> {
  const prefixes = await tx.documentTypePrefix.findMany({
    orderBy: [{ documentType: "asc" }],
  });
  return { data: prefixes };
}

/**
 * Seed default document-type prefixes for the tenant.
 * Mutation — receives AuditLogger and logs each created prefix.
 * Sets `prefixes_seeded = "true"` in TenantConfig to prevent re-seeding after delete-all.
 */
export async function seedDocumentTypePrefixes(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
): Promise<ServiceResult<{ seeded: number }>> {
  let count = 0;
  for (const [documentType, prefix] of Object.entries(DEFAULT_DOCUMENT_TYPE_PREFIXES)) {
    const created = await tx.documentTypePrefix.create({
      data: {
        tenantId: caller.tenantId,
        documentType,
        prefix,
        createdBy: caller.userId,
        source: "system",
      },
    });

    await audit.log({
      action: "create",
      entityType: "document_type_prefix",
      entityId: created.id,
      newData: toAuditData(created),
    });

    count++;
  }

  // Mark as seeded to prevent re-seeding after user deletes all prefixes
  await tx.tenantConfig.upsert({
    where: {
      tenantId_key: { tenantId: caller.tenantId, key: "prefixes_seeded" },
    },
    create: {
      tenantId: caller.tenantId,
      key: "prefixes_seeded",
      value: "true",
      createdBy: caller.userId,
      source: "system",
    },
    update: {
      value: "true",
    },
  });

  return { data: { seeded: count } };
}

/**
 * Check if prefixes have been seeded for the tenant.
 */
export async function isPrefixesSeeded(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<boolean> {
  const config = await tx.tenantConfig.findUnique({
    where: {
      tenantId_key: { tenantId: caller.tenantId, key: "prefixes_seeded" },
    },
  });
  return config?.value === "true";
}

/**
 * Create a new document-type prefix for the tenant.
 * Validates no duplicate documentType for tenant.
 */
export async function createDocumentTypePrefix(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { documentType: string; prefix: string },
): Promise<ServiceResult<{ id: string }>> {
  try {
    const created = await tx.documentTypePrefix.create({
      data: {
        tenantId: caller.tenantId,
        documentType: input.documentType,
        prefix: input.prefix,
        createdBy: caller.userId,
        source: caller.source,
      },
    });

    await audit.log({
      action: "create",
      entityType: "document_type_prefix",
      entityId: created.id,
      newData: toAuditData(created),
    });

    return { data: { id: created.id } };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return {
        error: {
          code: "DUPLICATE_ENTRY",
          message: `A prefix for document type "${input.documentType}" already exists`,
          retryable: false,
        },
      };
    }
    throw error;
  }
}

/**
 * Update an existing document-type prefix.
 * Only the prefix field can be updated (documentType is immutable after creation).
 * Read-before-write for audit oldData/newData.
 */
export async function updateDocumentTypePrefix(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
  input: { prefix: string },
): Promise<ServiceResult<{ updated: boolean }>> {
  const existing = await tx.documentTypePrefix.findUnique({ where: { id } });
  if (!existing) {
    return {
      error: {
        code: "NOT_FOUND",
        message: `Document-type prefix not found: ${id}`,
        retryable: false,
      },
    };
  }

  const updated = await tx.documentTypePrefix.update({
    where: { id },
    data: { prefix: input.prefix },
  });

  await audit.log({
    action: "update",
    entityType: "document_type_prefix",
    entityId: id,
    oldData: toAuditData(existing),
    newData: toAuditData(updated),
  });

  return { data: { updated: true } };
}

/**
 * Delete a document-type prefix.
 * Hard delete (no downstream references yet).
 * Read-before-delete for audit oldData.
 */
export async function deleteDocumentTypePrefix(
  tx: TransactionClient,
  _caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ deleted: boolean }>> {
  // TODO: Epic 5 — check for documents using this prefix before allowing delete
  const existing = await tx.documentTypePrefix.findUnique({ where: { id } });
  if (!existing) {
    return {
      error: {
        code: "NOT_FOUND",
        message: `Document-type prefix not found: ${id}`,
        retryable: false,
      },
    };
  }

  await tx.documentTypePrefix.delete({ where: { id } });

  await audit.log({
    action: "delete",
    entityType: "document_type_prefix",
    entityId: id,
    oldData: toAuditData(existing),
  });

  return { data: { deleted: true } };
}
