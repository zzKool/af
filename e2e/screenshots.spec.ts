import { mkdirSync } from "node:fs";
import { type Page, test } from "@playwright/test";

// Every run on main leaves a screenshot of each page in the `page-screenshots` artifact, light and dark
// (D40: light by default, dark from the OS) — the "something a human looked at" of the definition of done
// (constitution §4.5). Entity pages are reached from the first row of their list, when there is one.
const PAGES: Record<string, string> = {
  dashboard: "/dashboard",
  banking: "/banking",
  "banking-rules": "/banking/rules",
  "banking-inbox": "/banking/inbox",
  "banking-imports": "/banking/imports",
  documents: "/documents",
  "documents-inbox": "/documents/inbox",
  journal: "/journal",
  partners: "/partners",
  invoices: "/invoices",
  "invoices-new": "/invoices/new",
  "supplier-invoices": "/supplier-invoices",
  expenses: "/expenses",
  "expenses-groups": "/expenses/groups",
  "expenses-settle": "/expenses/settle",
  "expenses-settlements": "/expenses/settlements",
  package: "/package",
  declarations: "/exports",
  settings: "/settings",
  "settings-company": "/settings/company",
  "settings-bas-categories": "/settings/bas-categories",
  "settings-vat-registrations": "/settings/vat-registrations",
  "settings-bank-accounts": "/settings/bank-accounts",
  "settings-traktamente": "/settings/traktamente",
  "settings-rates": "/settings/rates",
  "settings-my-preferences": "/settings/my-preferences",
};

/** list → the entity page its first row opens (href pattern of that row's link) */
const ENTITIES: Record<string, { list: string; link: string }> = {
  "partner-entity": { list: "/partners", link: 'a[href^="/partners/"]' },
  "invoice-entity": { list: "/invoices", link: 'a[href^="/invoices/"]:not([href="/invoices/new"])' },
  "document-entity": { list: "/documents", link: 'a[href^="/documents/"]:not([href="/documents/inbox"])' },
  "expense-group-entity": { list: "/expenses/groups", link: 'a[href^="/expenses/groups/"]' },
};

const SCHEMES = ["light", "dark"] as const;

async function shoot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `e2e-screenshots/${name}.png`, fullPage: true });
}

test.describe("Page screenshots", () => {
  test.use({ storageState: "e2e/.auth/owner.json", viewport: { width: 1440, height: 900 } });

  for (const scheme of SCHEMES) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme });

      for (const [name, path] of Object.entries(PAGES)) {
        test(`screenshot ${name} (${scheme})`, async ({ page }) => {
          mkdirSync("e2e-screenshots", { recursive: true });
          await page.goto(path);
          await shoot(page, `${name}-${scheme}`);
        });
      }

      for (const [name, { list, link }] of Object.entries(ENTITIES)) {
        test(`screenshot ${name} (${scheme})`, async ({ page }) => {
          mkdirSync("e2e-screenshots", { recursive: true });
          await page.goto(list);
          const first = page.locator(`main ${link}`).first();
          test.skip((await first.count()) === 0, `no row on ${list} to open`);
          await page.goto((await first.getAttribute("href")) ?? list);
          await shoot(page, `${name}-${scheme}`);
        });
      }
    });
  }
});
