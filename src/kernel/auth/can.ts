// Authorisation — the ONE place that knows what a role may do (constitution §2, §6; decision D15).
// Everything else calls can() / canRole(); `role ===` comparisons outside src/kernel/auth are refused by the guard.
// The rules are a plain table so a CASL-style engine can replace it later without touching any call site.
import type { CallerIdentity, Role } from "./caller-identity";

export type Action = "read" | "create" | "update" | "delete" | "link" | "manage";

/** Subjects are coarse and business-named; attribute-dependent cases get their own subject (financial vs relationship documents). */
export type Subject =
  | "dashboard"
  | "partner"
  | "contract"
  | "financial_document" // invoices, receipts — the accountant may read these
  | "relationship_document" // contracts, NDAs, certificates — owner only
  | "link"
  | "bank_account"
  | "bank_transaction"
  | "journal_entry"
  | "invoice"
  | "supplier_invoice"
  | "expense"
  | "settlement"
  | "accountant_package"
  | "tenant_settings" // company profile, VAT registrations, BAS preferences, bank accounts, prefixes
  | "user_preferences"
  | "tenant_users" // members and invitations of the tenant
  | "app_settings"; // app-level: bank formats, currencies, tenants (superadmin)

const ALL: readonly Action[] = ["read", "create", "update", "delete", "link", "manage"];
const READ: readonly Action[] = ["read"];
const WORK: readonly Action[] = ["read", "create", "update", "link"];

type Rules = Partial<Record<Subject, readonly Action[]>>;

const TENANT_ALL: Rules = {
  dashboard: ALL,
  partner: ALL,
  contract: ALL,
  financial_document: ALL,
  relationship_document: ALL,
  link: ALL,
  bank_account: ALL,
  bank_transaction: ALL,
  journal_entry: ALL,
  invoice: ALL,
  supplier_invoice: ALL,
  expense: ALL,
  settlement: ALL,
  accountant_package: ALL,
  tenant_settings: ALL,
  user_preferences: ALL,
  tenant_users: ALL,
};

const RULES: Record<Role, Rules> = {
  superadmin: { ...TENANT_ALL, app_settings: ALL },
  owner: TENANT_ALL,
  // read-only on what the accountant needs; no relationship documents, no settings, no writes
  accountant: {
    dashboard: READ,
    partner: READ,
    financial_document: READ,
    link: READ,
    bank_account: READ,
    bank_transaction: READ,
    journal_entry: READ,
    invoice: READ,
    supplier_invoice: READ,
    expense: READ,
    settlement: READ,
    accountant_package: READ,
    user_preferences: ALL,
  },
  // delegated upload, OCR review and linking; no settings, no issuing, no deleting
  editor: {
    dashboard: READ,
    partner: READ,
    contract: READ,
    financial_document: WORK,
    relationship_document: WORK,
    link: WORK,
    bank_transaction: WORK,
    journal_entry: WORK,
    expense: WORK,
    user_preferences: ALL,
  },
};

/** Pure rule lookup — usable in client components that only know the role. */
export function canRole(role: Role, action: Action, subject: Subject): boolean {
  return RULES[role]?.[subject]?.includes(action) ?? false;
}

export function can(
  identity: Pick<CallerIdentity, "role">,
  action: Action,
  subject: Subject,
): boolean {
  return canRole(identity.role, action, subject);
}

/** Convenience for the common attribute case: a document is financial or a relationship document. */
export function documentSubject(documentType: string): Subject {
  return documentType === "financial" ? "financial_document" : "relationship_document";
}

/** Roles that administer a tenant (used by ownerAction and page guards). */
export function isTenantAdmin(identity: Pick<CallerIdentity, "role">): boolean {
  return identity.role === "owner" || identity.role === "superadmin";
}

/** Better Auth organisation role → application role. Members are accountants until the editor role is offered in the UI. */
export function roleFromMembership(orgRole: string | null | undefined): Role {
  if (orgRole === "owner") return "owner";
  if (orgRole === "editor") return "editor";
  return "accountant";
}
