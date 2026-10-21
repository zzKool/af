// Public DTOs of the rates module. Plain types only — never Prisma types (constitution §2).

/** What Settings → Exchange rates shows per pair: the newest stored day and how the last window looks. */
export type RatePairStatus = {
  pair: string;
  /** ISO date of the newest stored rate, null before the first fetch */
  latestDate: string | null;
  latestRate: string | null;
  /** stored ECB weekdays in the window */
  storedDays: number;
  /** ECB weekdays of the window (settled two days back) with no stored rate */
  missingWeekdays: number;
};
