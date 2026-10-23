// A manual entry justified from the journal (T003, US3, FR-004): *Link to…* a document or a client invoice. The
// allocation is proposed the way the banking inbox proposes one — min(what the entry has left, what the target has
// open), in the target's currency — and the link is written by linking (the only writer of `links`). Supplier
// invoices and expenses write their own payments (D37) and are not offered; a bank entry is justified from its
// transaction (T001).
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/browser";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { uuid } from "@/kernel/validation/scalars";
import type { LinkDto } from "@/modules/linking";

const D = Prisma.Decimal;

/** What a manual entry may be justified by from its panel: the `justifies` targets minus D37's own-payment ones. */
export const ENTRY_LINK_TARGETS = ["document", "invoice"] as const;

export const linkEntrySchema = z.object({
  id: uuid,
  to: z.object({ type: z.enum(ENTRY_LINK_TARGETS), id: uuid }),
});

const violation = (message: string): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message,
  retryable: false,
});

export async function linkEntry(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: z.input<typeof linkEntrySchema>,
): Promise<ServiceResult<LinkDto>> {
  const parsed = linkEntrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid input",
        retryable: false,
      },
    };
  }
  const { id, to } = parsed.data;
  const entry = await tx.journalEntry.findUnique({
    where: { id },
    select: { id: true, sourceType: true, amount: true, currency: true },
  });
  if (!entry)
    return {
      error: { code: "NOT_FOUND", message: `Journal entry not found: ${id}`, retryable: false },
    };
  if (entry.sourceType !== "manual")
    return { error: violation("A bank entry is justified from its transaction") };

  // loaded on first use, like implicit-rate.ts: a top-level import closes a load cycle through banking
  const linking = await import("@/modules/linking");
  const from = { type: "journal_entry" as const, id };
  const status = await linking.getAllocationStatus(tx, to);
  if (status.error) return { error: status.error };
  // a target with no amount (a document without an OCR total, or its currency unread): linked, nothing allocated
  if (status.data === null || new D(status.data.amount).lte(0)) {
    return linking.createLink(tx, caller, audit, { from, to, kind: "justifies" });
  }
  if (status.data.currency !== entry.currency) {
    return {
      error: violation(
        `The ${to.type === "invoice" ? "invoice" : "document"} is in ${status.data.currency}, the entry in ${entry.currency}`,
      ),
    };
  }
  const spent = (await linking.allocatedFrom(tx, "journal_entry", [id])).get(id) ?? "0";
  const left = entry.amount.abs().minus(new D(spent));
  const allocation = D.min(left, new D(status.data.remaining));
  if (allocation.lte(0)) {
    return {
      error: violation(
        left.lte(0)
          ? "This entry has nothing left to allocate"
          : `The ${to.type} has nothing left open`,
      ),
    };
  }
  return linking.createLink(tx, caller, audit, {
    from,
    to,
    kind: "justifies",
    allocatedAmount: allocation.toFixed(2),
    currency: status.data.currency,
  });
}
