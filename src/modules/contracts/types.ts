// Public DTOs of the contracts module. Plain types only — never Prisma types (constitution §2).
// Money crosses the surface as a decimal string (docs/decimal-currency.md); dates stay `Date` on the server surface.

export type ExternalReference = { label: string; value: string };

export type ContractDto = {
  id: string;
  tenantId: string;
  name: string;
  partnerId: string;
  startDate: Date;
  endDate: Date | null;
  assignedEmployeeId: string | null;
  /** Derived (D24): the rate valid today, never stored. Null when no rate covers today. */
  currentRate: CurrentRate | null;
  currency: string | null;
  paymentTerms: string | null;
  vatRegistrationId: string | null;
  externalReferences: ExternalReference[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};

// --- Rates (D24, specs/contracts) ---

/** Billing unit of a rate. One value today; adding one is an enum migration + a label (D24). */
export type RateUnit = "day";
export const RATE_UNITS: readonly RateUnit[] = ["day"];

/** Derived at read time, relative to a given "today" — never stored. */
export type RateState = "current" | "expired" | "future";

export type CurrentRate = { id: string; rate: string; unit: RateUnit };

/**
 * One dated rate of a contract. Validity bounds are calendar dates (ISO `YYYY-MM-DD`, inclusive) — not
 * instants — because the lookup is "which rate applies on this day". `validTo` null = open-ended.
 */
export type ContractRateDto = {
  id: string;
  tenantId: string;
  contractId: string;
  validFrom: string;
  validTo: string | null;
  /** Decimal as string, e.g. "1200.00", in the contract's currency. */
  rate: string;
  unit: RateUnit;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  source: string;
};

export type ContractRateWithState = ContractRateDto & { state: RateState };
