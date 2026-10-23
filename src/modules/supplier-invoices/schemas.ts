// The Zod schemas — the service's boundary: create, update, the VAT / category split lines.
import { z } from "zod/v4";
import { CURRENCIES } from "@/kernel/nav/constants";
import { basCode, isoDate, money, positiveMoney, uuid } from "@/kernel/validation/scalars";

// --- Zod schemas (the boundary) ---

const positiveRate = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "Use digits with up to 6 decimals")
  .refine((v) => Number(v) > 0, "The rate must be positive");

export const lineSchema = z.object({
  lineNo: z.number().int().min(1),
  description: z.string().trim().min(1, "Line description is required").max(200),
  amountNet: money,
  vatRate: z.string().regex(/^\d+(\.\d{1,2})?$/, "A VAT rate is a percentage"),
  vatAmount: money,
  basCode,
});
export type LineInput = z.input<typeof lineSchema>;

export const supplierInvoiceInputSchema = z
  .object({
    groupId: uuid,
    partnerId: uuid,
    invoiceNumber: z.string().trim().min(1, "The supplier's invoice number is required").max(100),
    invoiceDate: isoDate,
    /** omitted → invoice date + the partner's terms (30 when unset), flagged `dueDateDefaulted` */
    dueDate: isoDate.optional(),
    currency: z.enum(CURRENCIES).optional(),
    amountNet: money,
    vatAmount: money.optional(),
    amountTotal: positiveMoney,
    basCode,
    vatRegistrationId: uuid.nullable().optional(),
    /** typed by hand → rate_source = manual; omitted → ECB of the invoice date */
    rate: positiveRate.optional(),
    documentMissing: z.boolean().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    /** the reviewed document this invoice is created from (D27) */
    documentId: uuid.optional(),
    /** "Create anyway" on a high duplicate match (specs/documents US3) — the schema is declared here, not
     *  imported: expenses ↔ supplier-invoices meet through the linking registry at module load */
    duplicateAck: z
      .object({
        entityIds: z.array(uuid).min(1).max(5),
        note: z.string().trim().min(1, "Say why it is not a duplicate").max(500),
      })
      .optional(),
    /** the VAT / category split — none by default (FR-001) */
    lines: z.array(lineSchema).max(50).optional(),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.invoiceDate, {
    message: "The due date cannot be before the invoice date",
  });
export type SupplierInvoiceInput = z.input<typeof supplierInvoiceInputSchema>;

export const updateSupplierInvoiceSchema = z
  .object({
    partnerId: uuid.optional(),
    invoiceNumber: z.string().trim().min(1).max(100).optional(),
    invoiceDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    currency: z.enum(CURRENCIES).optional(),
    amountNet: money.optional(),
    vatAmount: money.optional(),
    amountTotal: positiveMoney.optional(),
    basCode: basCode.optional(),
    vatRegistrationId: uuid.nullable().optional(),
    rate: positiveRate.optional(),
    documentMissing: z.boolean().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    lines: z.array(lineSchema).max(50).nullable().optional(),
  })
  .refine((v) => !v.dueDate || !v.invoiceDate || v.dueDate >= v.invoiceDate, {
    message: "The due date cannot be before the invoice date",
  });
export type UpdateSupplierInvoiceInput = z.input<typeof updateSupplierInvoiceSchema>;
