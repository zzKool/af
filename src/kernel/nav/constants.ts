// Business constants — client-safe (NO @prisma/client import)

import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { MessageKey } from "@/kernel/i18n/dictionaries/en";

// Navigation configuration

/** The sidebar's groups (D40): the order follows the owner's monthly loop — the bank statement first, then a
 *  document for each line, then sales, costs and the close. Labels are `nav.group.<group>`. */
export const NAV_GROUPS = ["records", "sales", "costs", "close"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export type NavItem = {
  path: string;
  /** English label — the sidebar and the breadcrumb show `t(labelKey)` in the user's language */
  label: string;
  labelKey: Extract<MessageKey, `nav.${string}`>;
  icon: string; // lucide-react icon name — resolved in sidebar component
  roles: CallerIdentity["role"][];
  enabled: boolean;
  /** the sidebar group; null = ungrouped at the top (Dashboard) */
  group: NavGroup | null;
  /** pinned to the bottom of the sidebar (Settings) */
  bottom?: true;
};

/**
 * Central navigation items config. Sidebar reads from this array, in this order (grouped by `group`).
 * To enable a new route: set enabled: true when the page is built; place it where it falls in the monthly loop.
 * Security note: All paths are visible in the client bundle even when disabled.
 * Server Actions enforce RBAC — sidebar hiding is UI convenience only.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: "/dashboard",
    label: "Dashboard",
    labelKey: "nav.dashboard",
    icon: "LayoutDashboard",
    roles: ["owner", "accountant"],
    enabled: true,
    group: null,
  },
  {
    path: "/banking",
    label: "Banking",
    labelKey: "nav.banking",
    icon: "Landmark",
    roles: ["owner", "accountant"],
    enabled: true,
    group: "records",
  },
  {
    path: "/documents",
    label: "Documents",
    labelKey: "nav.documents",
    icon: "FileText",
    roles: ["owner"],
    enabled: true,
    group: "records",
  },
  {
    path: "/journal",
    label: "Journal",
    labelKey: "nav.journal",
    icon: "BookOpen",
    roles: ["owner", "accountant"],
    enabled: true,
    group: "records",
  },
  {
    path: "/reconciliation",
    label: "Reconciliation",
    labelKey: "nav.reconciliation",
    icon: "ArrowLeftRight",
    roles: ["owner"],
    enabled: false,
    group: "records",
  },
  {
    path: "/partners",
    label: "Partners",
    labelKey: "nav.partners",
    icon: "Users",
    roles: ["owner"],
    enabled: true,
    group: "sales",
  },
  {
    path: "/invoices",
    label: "Invoices",
    labelKey: "nav.invoices",
    icon: "Receipt",
    roles: ["owner", "accountant"],
    enabled: true,
    group: "sales",
  },
  {
    path: "/supplier-invoices",
    label: "Supplier invoices",
    labelKey: "nav.supplierInvoices",
    icon: "ReceiptText",
    roles: ["owner", "accountant"],
    enabled: true,
    group: "costs",
  },
  {
    path: "/expenses",
    label: "Expenses",
    labelKey: "nav.expenses",
    icon: "Wallet",
    roles: ["owner", "accountant"],
    enabled: true,
    group: "costs",
  },
  {
    path: "/subscriptions",
    label: "Subscriptions",
    labelKey: "nav.subscriptions",
    icon: "Repeat",
    roles: ["owner", "accountant"],
    enabled: true,
    group: "costs",
  },
  {
    path: "/package",
    label: "Package",
    labelKey: "nav.package",
    icon: "Archive",
    roles: ["owner", "accountant"],
    enabled: true,
    group: "close",
  },
  {
    path: "/exports",
    label: "Declarations",
    labelKey: "nav.declarations",
    icon: "FileSpreadsheet",
    roles: ["owner", "accountant"],
    enabled: true,
    group: "close",
  },
  {
    path: "/settings",
    label: "Settings",
    labelKey: "nav.settings",
    icon: "Settings",
    roles: ["owner", "accountant"],
    enabled: true,
    group: null,
    bottom: true,
  },
];

/** The sidebar's **+ New** menu: each entry opens the page whose primary action makes the thing — with `?new=1`,
 *  which opens that action's dialog at once (F73, `kernel/ui/shell/use-new-param.ts`); a new invoice is a page. */
export type NewItem = {
  href: string;
  labelKey: Extract<MessageKey, `nav.new.${string}`>;
  icon: string;
  roles: CallerIdentity["role"][];
};
export const NEW_ITEMS: readonly NewItem[] = [
  { href: "/documents?new=1", labelKey: "nav.new.document", icon: "Upload", roles: ["owner"] },
  { href: "/banking?new=1", labelKey: "nav.new.csv", icon: "Landmark", roles: ["owner"] },
  { href: "/invoices/new", labelKey: "nav.new.invoice", icon: "Receipt", roles: ["owner"] },
  {
    href: "/supplier-invoices?new=1",
    labelKey: "nav.new.supplierInvoice",
    icon: "ReceiptText",
    roles: ["owner"],
  },
  { href: "/expenses?new=1", labelKey: "nav.new.expense", icon: "Wallet", roles: ["owner"] },
  {
    href: "/subscriptions?new=1",
    labelKey: "nav.new.subscription",
    icon: "Repeat",
    roles: ["owner"],
  },
];

/**
 * Role → default landing page mapping.
 * Both roles land on /dashboard for now; future: accountant → /periods.
 */
export const ROLE_LANDING_PAGE: Record<CallerIdentity["role"], string> = {
  superadmin: "/dashboard",
  owner: "/dashboard",
  accountant: "/dashboard",
  editor: "/dashboard",
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

// Payment terms — machine-readable constants for contract billing
export const PAYMENT_TERMS = [
  "NET_10",
  "NET_15",
  "NET_30",
  "NET_45",
  "NET_60",
  "NET_90",
  "PREPAID",
  "ON_RECEIPT",
] as const;
export type PaymentTerm = (typeof PAYMENT_TERMS)[number];

// Supported locales for user preferences
export const SUPPORTED_LOCALES = ["sv-SE", "en-US", "en-GB", "fr-FR", "fr-CH", "de-CH"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// App configuration constants (from architecture doc)
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_FILE_SIZE_MB = 10;
export const OCR_MAX_RETRIES = 3;
export const ECB_RATE_STALE_DAYS = 3;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 30;
