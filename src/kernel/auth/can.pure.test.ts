import { describe, expect, it } from "vitest";
import {
  can,
  canRole,
  documentSubject,
  isKnownOrgRole,
  isTenantAdmin,
  roleFromMembership,
} from "./can";

describe("can() — the role table (constitution §6)", () => {
  it("owner and superadmin may do everything in a tenant; only superadmin touches app settings", () => {
    for (const role of ["owner", "superadmin"] as const) {
      expect(canRole(role, "delete", "financial_document")).toBe(true);
      expect(canRole(role, "manage", "tenant_settings")).toBe(true);
      expect(canRole(role, "read", "relationship_document")).toBe(true);
      expect(isTenantAdmin({ role })).toBe(true);
    }
    expect(canRole("owner", "manage", "app_settings")).toBe(false);
    expect(canRole("superadmin", "manage", "app_settings")).toBe(true);
  });

  it("accountant is read-only on financial data and blind to relationship documents and settings", () => {
    expect(canRole("accountant", "read", "financial_document")).toBe(true);
    expect(canRole("accountant", "read", "journal_entry")).toBe(true);
    expect(canRole("accountant", "read", "accountant_package")).toBe(true);
    expect(canRole("accountant", "read", "relationship_document")).toBe(false);
    expect(canRole("accountant", "update", "financial_document")).toBe(false);
    expect(canRole("accountant", "create", "link")).toBe(false);
    expect(canRole("accountant", "manage", "tenant_settings")).toBe(false);
    expect(canRole("accountant", "update", "user_preferences")).toBe(true);
    expect(isTenantAdmin({ role: "accountant" })).toBe(false);
  });

  it("editor works on documents and links but never settings, deletion or issuing", () => {
    expect(canRole("editor", "create", "financial_document")).toBe(true);
    expect(canRole("editor", "link", "link")).toBe(true);
    expect(canRole("editor", "delete", "financial_document")).toBe(false);
    expect(canRole("editor", "create", "invoice")).toBe(false);
    expect(canRole("editor", "manage", "tenant_settings")).toBe(false);
  });

  it("documentSubject() and roleFromMembership() map attributes to the table", () => {
    expect(documentSubject("financial")).toBe("financial_document");
    expect(documentSubject("relationship")).toBe("relationship_document");
    expect(can({ role: "accountant" }, "read", documentSubject("financial"))).toBe(true);
    expect(can({ role: "accountant" }, "read", documentSubject("relationship"))).toBe(false);
    expect(roleFromMembership("owner")).toBe("owner");
    expect(roleFromMembership("member")).toBe("accountant");
    expect(roleFromMembership("editor")).toBe("editor");
    // F105: an unknown organisation role is refused before it is mapped — by the pages and the actions alike
    expect(isKnownOrgRole("owner")).toBe(true);
    expect(isKnownOrgRole("member")).toBe(true);
    expect(isKnownOrgRole("editor")).toBe(true);
    expect(isKnownOrgRole("admin")).toBe(false);
    expect(isKnownOrgRole(null)).toBe(false);
    expect(isKnownOrgRole(undefined)).toBe(false);
    expect(roleFromMembership(undefined)).toBe("accountant");
  });
});
