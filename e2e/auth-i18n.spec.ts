import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const SHOTS = join(__dirname, "..", "specs", "kernel-ui", "screenshots");

async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// Login and register come before any user preference: the browser's Accept-Language picks the language (F04).
test.describe("Auth pages in French", () => {
  test.use({ locale: "fr-CH" });

  test("register in French: labels, the default company name, then the app in French", async ({
    page,
  }) => {
    const stamp = Date.now();
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Créer un compte" })).toBeVisible();
    await snap(page, "fr-register");
    await page.getByLabel("Nom").fill(`Fr Owner ${stamp}`);
    await page.getByLabel("E-mail").fill(`fr-${stamp}@dev.test`);
    await page.getByLabel("Mot de passe").fill("e2e-password-12345");
    await page.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    // the tenant created at registration is named in the page's language
    await expect(page.getByRole("banner")).toContainText(`Entreprise de Fr Owner ${stamp}`);
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toContainText(
      "Tableau de bord",
    );
    // no preference yet: the server-rendered page follows the browser too, not English (F56)
    await expect(
      page.getByRole("heading", { name: `Bon retour, Fr Owner ${stamp}` }),
    ).toBeVisible();
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Factures" })).toBeVisible();
  });

  test("login in French, with the error message", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
    await page.getByLabel("E-mail").fill("nobody@dev.test");
    await page.getByLabel("Mot de passe").fill("wrong-password-1");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText(/L'e-mail ou le mot de passe ne correspond pas/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Créer un compte" })).toBeVisible();
    await snap(page, "fr-login-error");
  });
});

test.describe("Auth pages in Swedish", () => {
  test.use({ locale: "sv-SE" });

  test("login and register in Swedish", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Logga in" })).toBeVisible();
    await expect(page.getByLabel("Lösenord")).toBeVisible();
    await snap(page, "sv-login");
    await page.getByRole("link", { name: "Registrera dig" }).click();
    await expect(page.getByRole("heading", { name: "Skapa konto" })).toBeVisible();
    // an address that already has an account: the owner from the seed
    await page.getByLabel("E-post").fill("owner@dev.test");
    await page.getByLabel("Lösenord").fill("e2e-password-12345");
    await page.getByRole("button", { name: "Skapa konto" }).click();
    await expect(
      page.getByText("Det finns redan ett konto med den här e-postadressen."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Logga in i stället?" })).toBeVisible();
    await snap(page, "sv-register-taken");
  });
});

test.describe("Auth pages fall back to English", () => {
  test.use({ locale: "de-CH" });

  test("a browser language without a dictionary gets English", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});
