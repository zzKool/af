// Business constants — client-safe (NO @prisma/client import)

// Currency
export const CURRENCIES = ["SEK", "CHF", "EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const BASE_CURRENCY: Currency = "SEK";

// Precision rules — domain-driven, not arbitrary
export const CURRENCY_DECIMAL_PLACES = 2; // öre/Rappen/cents — legal requirement
export const EXCHANGE_RATE_DECIMAL_PLACES = 6; // ECB publishes at this precision

// VAT rates as numbers — string values for safe Decimal construction in services
// IMPORTANT: Services must construct Decimal from these string values, never from numbers.
// 7.7 as IEEE 754 float is 7.69999...; new Prisma.Decimal('7.7') is exact.
export const DEFAULT_VAT_RATE_SE = 25;
export const DEFAULT_VAT_RATE_CH = 7.7;
// String versions for safe Decimal construction in service layer:
export const DEFAULT_VAT_RATE_SE_STR = "25";
export const DEFAULT_VAT_RATE_CH_STR = "7.7";

// App configuration constants (from architecture doc)
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_FILE_SIZE_MB = 10;
export const SIGNED_URL_TTL_SECONDS = 300;
export const OCR_MAX_RETRIES = 3;
export const ECB_RATE_STALE_DAYS = 3;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 30;
