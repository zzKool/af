// Business constants — client-safe (NO @prisma/client import)

import type { CallerIdentity } from "@/types/caller-identity";

// Navigation configuration
export type NavItem = {
  path: string;
  label: string;
  icon: string; // lucide-react icon name — resolved in sidebar component
  roles: CallerIdentity["role"][];
  enabled: boolean;
};

/**
 * Central navigation items config. Sidebar reads from this array.
 * To enable a new route: set enabled: true when the page is built.
 * Security note: All paths are visible in the client bundle even when disabled.
 * Server Actions enforce RBAC — sidebar hiding is UI convenience only.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: "/dashboard",
    label: "Dashboard",
    icon: "LayoutDashboard",
    roles: ["owner", "accountant"],
    enabled: true,
  },
  {
    path: "/documents",
    label: "Documents",
    icon: "FileText",
    roles: ["owner", "accountant"],
    enabled: false,
  },
  {
    path: "/journal",
    label: "Journal",
    icon: "BookOpen",
    roles: ["owner", "accountant"],
    enabled: false,
  },
  { path: "/banking", label: "Banking", icon: "Landmark", roles: ["owner"], enabled: false },
  { path: "/partners", label: "Partners", icon: "Users", roles: ["owner"], enabled: false },
  {
    path: "/reconciliation",
    label: "Reconciliation",
    icon: "ArrowLeftRight",
    roles: ["owner"],
    enabled: false,
  },
  { path: "/invoices", label: "Invoices", icon: "Receipt", roles: ["owner"], enabled: false },
  {
    path: "/settings",
    label: "Settings",
    icon: "Settings",
    roles: ["owner", "accountant"],
    enabled: true,
  },
];

/**
 * Role → default landing page mapping.
 * Both roles land on /dashboard for now; future: accountant → /periods.
 */
export const ROLE_LANDING_PAGE: Record<CallerIdentity["role"], string> = {
  owner: "/dashboard",
  accountant: "/dashboard",
};

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

// Document-type prefixes — default seed values for new tenants
export const DEFAULT_DOCUMENT_TYPE_PREFIXES: Record<string, string> = {
  expense: "exp_",
  invoice: "inv_",
  contract: "ctrt_",
  nda: "nda_",
  certificate: "cert_",
};

// Supported locales for user preferences
export const SUPPORTED_LOCALES = ["sv-SE", "en-US", "en-GB", "fr-FR", "de-CH"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// App configuration constants (from architecture doc)
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_FILE_SIZE_MB = 10;
export const SIGNED_URL_TTL_SECONDS = 300;
export const OCR_MAX_RETRIES = 3;
export const ECB_RATE_STALE_DAYS = 3;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 30;
