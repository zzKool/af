// Zod schema of a ListQuery — the boundary of the actions that serve header filters (distinct values,
// date hierarchies). Server-safe; the codec already guarantees shape, this guards the action input.
import { z } from "zod/v4";
import { PAGE_SIZE_OPTIONS } from "./types";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/);
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

export const filterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("in"), values: z.array(z.string().max(200).nullable()).max(500) }),
  z.object({
    kind: z.literal("text"),
    op: z.enum(["contains", "startsWith", "equals", "empty", "notEmpty"]),
    value: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("range"),
    min: decimal.optional(),
    max: decimal.optional(),
    empty: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("dates"),
    years: z.array(z.number().int().min(1900).max(2200)).max(50).optional(),
    months: z.array(isoMonth).max(200).optional(),
    days: z.array(isoDay).max(500).optional(),
    from: isoDay.optional(),
    to: isoDay.optional(),
    empty: z.boolean().optional(),
  }),
]);

export const listQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z
    .number()
    .int()
    .refine((n) => (PAGE_SIZE_OPTIONS as readonly number[]).includes(n), "unsupported page size")
    .default(25),
  sort: z
    .array(z.object({ col: z.string().max(60), dir: z.enum(["asc", "desc"]) }))
    .max(5)
    .default([]),
  filters: z.record(z.string().max(60), filterSchema).default({}),
  search: z.string().max(200).optional(),
});

export type ListQueryInput = z.input<typeof listQuerySchema>;
