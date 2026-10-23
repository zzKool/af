// The two reads the service answers itself: one invoice, and "Copy last" (the supplier's latest as a prefill).
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { toSupplierInvoiceDto } from "./dto";
import type { SupplierInvoiceDto } from "./types";

/** "Copy last": the supplier's latest invoice as a prefill — amounts, category, registration; a new number and dates. */
export async function copyLastPrefill(
  tx: TransactionClient,
  partnerId: string,
): Promise<
  ServiceResult<Pick<
    SupplierInvoiceDto,
    | "currency"
    | "amountNet"
    | "vatAmount"
    | "amountTotal"
    | "basCode"
    | "vatRegistrationId"
    | "note"
    | "groupId"
  > | null>
> {
  const row = await tx.supplierInvoice.findFirst({
    where: { partnerId, cancelled: false },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
  });
  if (!row) return { data: null };
  const dto = toSupplierInvoiceDto(row);
  return {
    data: {
      currency: dto.currency,
      amountNet: dto.amountNet,
      vatAmount: dto.vatAmount,
      amountTotal: dto.amountTotal,
      basCode: dto.basCode,
      vatRegistrationId: dto.vatRegistrationId,
      note: dto.note,
      groupId: dto.groupId,
    },
  };
}

export async function getSupplierInvoice(
  tx: TransactionClient,
  id: string,
): Promise<SupplierInvoiceDto | null> {
  const row = await tx.supplierInvoice.findUnique({ where: { id }, include: { lines: true } });
  return row ? toSupplierInvoiceDto(row) : null;
}
