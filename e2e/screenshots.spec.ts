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
  "documents-new": "/documents?new=1",
  "documents-inbox": "/documents/inbox",
  journal: "/journal",
  partners: "/partners",
  invoices: "/invoices",
  "invoices-new": "/invoices/new",
  "supplier-invoices": "/supplier-invoices",
  "supplier-invoices-new": "/supplier-invoices?new=1",
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
  "invoice-entity": {
    list: "/invoices",
    link: 'a[href^="/invoices/"]:not([href="/invoices/new"])',
  },
  "document-entity": {
    list: "/documents",
    link: 'a[href^="/documents/"]:not([href="/documents/inbox"])',
  },
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

      // the partner page's Contracts tab with one contract open (its form and Rates) — the client the invoices
      // journey leaves behind has a contract with a current rate (F71: contracts on the D40 kit)
      test(`screenshot partner-contracts (${scheme})`, async ({ page }) => {
        mkdirSync("e2e-screenshots", { recursive: true });
        await page.goto("/partners?q=E2E%20Client");
        const first = page.locator('main a[href^="/partners/"]').first();
        test.skip((await first.count()) === 0, "no E2E client with a contract");
        await page.goto((await first.getAttribute("href")) ?? "/partners");
        await page.getByRole("tab", { name: /Contracts/ }).click();
        const contract = page.getByText("Consulting", { exact: true }).first();
        test.skip((await contract.count()) === 0, "the client has no contract");
        await contract.click();
        await page.getByTestId("contract-rates").waitFor();
        await shoot(page, `partner-contracts-${scheme}`);
      });

      // F71, partners on the D40 kit: the list's one primary opens a dialog; the partner page's Contacts tab
      // (the partners journey leaves "E2E Contacts …" behind)
      test(`screenshot partners-new (${scheme})`, async ({ page }) => {
        mkdirSync("e2e-screenshots", { recursive: true });
        await page.goto("/partners");
        await page.getByRole("button", { name: "Add partner" }).click();
        await page.getByTestId("new-partner-dialog").waitFor();
        await shoot(page, `partners-new-${scheme}`);
      });

      test(`screenshot partner-contacts (${scheme})`, async ({ page }) => {
        mkdirSync("e2e-screenshots", { recursive: true });
        await page.goto("/partners?q=E2E%20Contacts");
        const first = page.locator('main a[href^="/partners/"]').first();
        test.skip((await first.count()) === 0, "no E2E partner with contacts");
        await page.goto((await first.getAttribute("href")) ?? "/partners");
        await page.getByRole("tab", { name: /Contacts/ }).click();
        await page.getByTestId("partner-contacts").waitFor();
        await shoot(page, `partner-contacts-${scheme}`);
      });

      // F87: the expense dialog with a partner picked (its category proposed), the list's Partner column, the
      // partner's Expenses tab — the expenses journey leaves "E2E Bistro …" with one expense behind. The dialog
      // from a document (the match card) is not shot here: it needs a document no other journey takes meanwhile
      // (it raced document-review on main, 2026-10-24) — its screenshots are in specs/expense-partner/screenshots/
      test(`screenshot expense-partner-dialog (${scheme})`, async ({ page }) => {
        mkdirSync("e2e-screenshots", { recursive: true });
        await page.goto("/expenses");
        await page.getByTestId("open-new-expense").click();
        const dialog = page.getByTestId("new-expense-dialog");
        await dialog.waitFor();
        await dialog.getByLabel("Partner", { exact: true }).click();
        const bistro = page.getByRole("option", { name: /E2E Bistro/ }).first();
        test.skip((await bistro.count()) === 0, "no E2E Bistro vendor");
        await bistro.click();
        await shoot(page, `expense-partner-dialog-${scheme}`);
      });

      test(`screenshot expense-partner-list (${scheme})`, async ({ page }) => {
        mkdirSync("e2e-screenshots", { recursive: true });
        await page.goto("/expenses?q=E2E%20Bistro");
        await shoot(page, `expense-partner-list-${scheme}`);
      });

      test(`screenshot partner-expenses (${scheme})`, async ({ page }) => {
        mkdirSync("e2e-screenshots", { recursive: true });
        await page.goto("/partners?q=E2E%20Bistro");
        const first = page.locator('main a[href^="/partners/"]').first();
        test.skip((await first.count()) === 0, "no E2E Bistro vendor");
        await page.goto((await first.getAttribute("href")) ?? "/partners");
        await page.getByRole("tab", { name: /^Expenses/ }).click();
        await page.getByTestId("partner-expenses").waitFor();
        await shoot(page, `partner-expenses-${scheme}`);
      });

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
