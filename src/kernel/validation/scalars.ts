/**
 * Shared Zod scalars — the field-level rules every module's input schemas repeat.
 * The business schemas (an expense, an invoice line) stay in their modules; only
 * these leaves are shared. Messages are the ones the modules used before (F50-e).
 */
import { z } from "zod/v4";

/** A UUID string (entity ids, cross-module references). */
export const uuid = z.string().uuid();

/** A calendar date as `YYYY-MM-DD`. */
export const isoDate = z.string().date();

/** A non-negative amount as a decimal string with up to 2 decimals (`"0"`, `"12.5"`). */
export const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Use digits with up to 2 decimals");

/** `money`, strictly greater than zero. */
export const positiveMoney = money.refine((v) => Number(v) > 0, "The amount must be positive");

/** An exchange rate as a decimal string with up to 6 decimals, strictly greater than zero (`"11.234567"`). */
export const positiveRate = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "Use digits with up to 6 decimals")
  .refine((v) => Number(v) > 0, "The rate must be positive");

/** A BAS account code: 3 or 4 digits. */
export const basCode = z.string().regex(/^\d{3,4}$/, "A BAS code is 3 or 4 digits");
