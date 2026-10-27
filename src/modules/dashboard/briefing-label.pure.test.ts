import { describe, expect, it } from "vitest";
import { en } from "@/kernel/i18n/dictionaries/en";
import { fr } from "@/kernel/i18n/dictionaries/fr";
import { sv } from "@/kernel/i18n/dictionaries/sv";
import { translator } from "@/kernel/i18n/translate";
import { briefingText } from "./briefing-label";

// every entity type and action the services write to the audit trail (grep `entityType: "` / `action: "`)
const ENTITY_TYPES = [
  "bank_account",
  "bank_import",
  "bank_transaction",
  "categorisation_rule",
  "contract",
  "contract_rate",
  "document",
  "expense",
  "expense_group",
  "invoice",
  "link",
  "normalbelopp",
  "package_build",
  "partner",
  "partner_contact",
  "payment_source",
  "settlement",
  "supplier_invoice",
  "swiss_vat_declaration",
  "tenant",
  "tenant_bas_preference",
  "trip",
  "user_preference",
  "vat_registration",
];
const ACTIONS = ["create", "update", "delete", "deactivate", "reactivate"];

describe("the briefing's words", () => {
  it("every entity type and action has its key in en, fr and sv", () => {
    for (const dict of [en, fr, sv] as Record<string, string>[]) {
      for (const type of ENTITY_TYPES)
        expect(dict).toHaveProperty([`dashboard.briefing.entity.${type}`]);
      for (const a of ACTIONS) expect(dict).toHaveProperty([`dashboard.briefing.action.${a}`]);
    }
  });

  it("a line reads in the reader's language, not in English", () => {
    const line = { entityType: "bank_transaction", action: "create" };
    expect(briefingText(translator("en"), line)).toBe("bank transaction(s) created");
    expect(briefingText(translator("fr"), line)).toBe("transaction(s) bancaire(s) créé(s)");
    expect(briefingText(translator("sv"), line)).toBe("banktransaktion(er) skapade");
  });

  it("the partners' deactivate / reactivate are words, not raw keys", () => {
    expect(briefingText(translator("fr"), { entityType: "partner", action: "deactivate" })).toBe(
      "partenaire(s) désactivé(s)",
    );
    expect(briefingText(translator("en"), { entityType: "partner", action: "reactivate" })).toBe(
      "partner(s) reactivated",
    );
  });

  it("a type or action no dictionary knows yet reads as its spaced name", () => {
    expect(briefingText(translator("sv"), { entityType: "new_thing", action: "archive" })).toBe(
      "new thing archive",
    );
  });
});
