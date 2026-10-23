// The service's input boundary — what the actions and the forms send.
import { z } from "zod/v4";
import { CURRENCIES } from "@/kernel/nav/constants";
import { isoDate, money, uuid } from "@/kernel/validation/scalars";
import { RATE_UNITS, type RateUnit } from "@/modules/contracts";
import { isDeclarationPeriod } from "./derive";

// --- Zod schemas (the boundary) ---

const percent = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Use digits with up to 2 decimals")
  .refine((v) => Number(v) <= 100, "At most 100");

export const lineInputSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(5000),
  quantity: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, "Quantity: digits with up to 4 decimals")
    .refine((v) => Number(v) <= 999999.9999, "Quantity too large"),
  unit: z.enum(RATE_UNITS as [RateUnit, ...RateUnit[]]).default("day"),
  unitPrice: money,
  discountPercent: percent.nullable().optional(),
  discountFixed: money.nullable().optional(),
  vatRate: percent,
  periodStart: isoDate.nullable().optional(),
  periodEnd: isoDate.nullable().optional(),
  rateSourceId: uuid.nullable().optional(),
});
export type LineInputDto = z.input<typeof lineInputSchema>;

const referenceSchema = z.object({
  label: z.string().trim().min(1).max(50),
  value: z.string().trim().min(1).max(100),
});

const headerFields = {
  contractId: uuid.nullable().optional(),
  vatRegistrationId: uuid.nullable().optional(),
  issueDate: isoDate.optional(),
  dueDate: isoDate.nullable().optional(),
  periodLabel: z.string().trim().max(100).nullable().optional(),
  periodStart: isoDate.nullable().optional(),
  periodEnd: isoDate.nullable().optional(),
  currency: z.enum(CURRENCIES).optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
  printedReferences: z.array(referenceSchema).max(10).optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
  internalNote: z.string().trim().max(10000).nullable().optional(),
  paymentTermsText: z.string().trim().max(1000).nullable().optional(),
  discountPercent: percent.nullable().optional(),
};

export const createDraftSchema = z.object({
  type: z.enum(["invoice", "quote"]).default("invoice"),
  partnerId: uuid,
  ...headerFields,
  lines: z.array(lineInputSchema).max(200).optional(),
});
export type CreateDraftInput = z.input<typeof createDraftSchema>;

export const updateDraftSchema = z.object({
  id: uuid,
  ...headerFields,
  lines: z.array(lineInputSchema).max(200).optional(),
});
export type UpdateDraftInput = z.input<typeof updateDraftSchema>;

export const issueSchema = z.object({ id: uuid, issueDate: isoDate.optional() });
export type IssueInput = z.input<typeof issueSchema>;

export const creditNoteSchema = z.object({
  originalId: uuid,
  /** omitted = full credit; otherwise the lines to credit with the quantity to credit on each */
  lines: z
    .array(z.object({ lineId: uuid, quantity: z.string().regex(/^\d+(\.\d{1,4})?$/) }))
    .min(1)
    .optional(),
});
export type CreditNoteInput = z.input<typeof creditNoteSchema>;

export const declarationPeriodSchema = z.object({
  id: uuid,
  declarationPeriod: z
    .string()
    .trim()
    .refine((v) => isDeclarationPeriod(v), "Expected a period like CH 2026/Q1")
    .nullable(),
});
