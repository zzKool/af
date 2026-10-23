import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Happy path of the reference slice: create → list filter (URL state) → open entity page.
test.describe("Partners", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  const stamp = String(Date.now()).slice(-5);
  const name = `E2E Partner ${stamp}`;
  const shortCode = `E${stamp}`; // unique per tenant per run

  test("create a partner from the list, filter by type, open it", async ({ page }) => {
    await page.goto("/partners");
    await expect(page.getByRole("heading", { name: "Partners" })).toBeVisible();

    // A client (the one we follow) and a vendor (so the Types filter has something to exclude)
    await page.getByRole("button", { name: "Add partner" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(name);
    await page.getByRole("textbox", { name: "Short code" }).fill(shortCode);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Partner created")).toBeVisible();
    await expect(page.getByRole("link", { name })).toBeVisible();

    await page.getByRole("button", { name: "Add partner" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(`${name} vendor`);
    await page.getByLabel("client").uncheck();
    await page.getByLabel("vendor").check();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("link", { name: `${name} vendor` })).toBeVisible();

    // Header filter: Types → only clients; the state lands in the URL
    await page.getByRole("button", { name: "Filter Types" }).click();
    await page.getByRole("button", { name: "Clear" }).first().click();
    await page.getByRole("listbox").getByText("client", { exact: true }).click();
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await expect(page).toHaveURL(/f\.types=in%3Aclient/);
    await expect(page.getByRole("link", { name })).toBeVisible();
    await expect(page.getByRole("link", { name: `${name} vendor` })).toHaveCount(0);

    // Search box narrows further
    await page.getByRole("textbox", { name: "Search", exact: true }).fill(name);
    await page.getByRole("textbox", { name: "Search", exact: true }).press("Enter");
    await expect(page).toHaveURL(/q=E2E/);
    await expect(page.getByText("1–1 of 1")).toBeVisible();

    // Entity page
    await page.getByRole("link", { name }).click();
    await expect(page).toHaveURL(/\/partners\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Short code" })).toHaveValue(shortCode);

    // the relationships: nothing names or is linked to a brand-new partner; the graph is one click away
    // F71: the state is a label, the types grey tags, the counts badges on the underline tabs
    await expect(page.getByTestId("partner-state").first()).toHaveAttribute(
      "data-partner-state",
      "active",
    );
    await page.getByRole("tab", { name: "Transactions 0", exact: true }).click();
    await expect(page.getByText("No journal entry names this partner yet.")).toBeVisible();
    await page.getByRole("tab", { name: "Documents 0", exact: true }).click();
    await expect(page.getByText("No document is linked to this partner yet.")).toBeVisible();
    // the partner's own actions sit in the title row's ⋮; the state follows without a reload
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Deactivate" }).press("Enter");
    await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText(`${name} deactivated`)).toBeVisible();
    await expect(page.getByTestId("partner-state").first()).toHaveAttribute(
      "data-partner-state",
      "inactive",
    );
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Reactivate" }).press("Enter");
    await expect(page.getByText(`${name} reactivated`)).toBeVisible();
    await expect(page.getByTestId("partner-state").first()).toHaveAttribute(
      "data-partner-state",
      "active",
    );
    await page.getByTestId("graph-link").click();
    await expect(page).toHaveURL(/\/links\/partner\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  });

  // F08 (specs/partners/spec.md): contact persons on a partner it creates — add, edit, delete; the tab count follows.
  test("contact persons: add, edit, delete on the partner page", async ({ page }) => {
    const partner = `E2E Contacts ${stamp}`;
    await page.goto("/partners");
    await page.getByRole("button", { name: "Add partner" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(partner);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Partner created")).toBeVisible();
    await page.getByRole("link", { name: partner }).click();
    await expect(page.getByRole("heading", { name: partner })).toBeVisible();

    await page.getByRole("tab", { name: "Contacts 0", exact: true }).click();
    const contacts = page.getByTestId("partner-contacts");
    await expect(contacts.getByText("No contact persons yet.")).toBeVisible();

    // add: a bad e-mail is refused, then the real one
    await contacts.getByRole("button", { name: "Add contact" }).click();
    await contacts.getByRole("textbox", { name: "Name" }).fill("Anne Muster");
    await contacts.getByRole("textbox", { name: "Role" }).fill("Head of BI");
    await contacts.getByRole("textbox", { name: "E-mail" }).fill("anne@");
    await contacts.getByRole("textbox", { name: "Phone" }).fill("+41 21 618 80 80");
    await contacts.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Not a valid e-mail address")).toBeVisible();
    await contacts.getByRole("textbox", { name: "E-mail" }).fill("anne.muster@example.ch");
    await contacts.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Contact added")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Contacts 1", exact: true })).toBeVisible();
    const row = contacts.getByTestId("contact-row");
    await expect(row).toContainText("Head of BI");
    await expect(row.getByRole("link", { name: "anne.muster@example.ch" })).toHaveAttribute(
      "href",
      "mailto:anne.muster@example.ch",
    );
    await expect(row.getByRole("link", { name: "+41 21 618 80 80" })).toHaveAttribute(
      "href",
      "tel:+41216188080",
    );

    mkdirSync("e2e-screenshots", { recursive: true });
    await page.screenshot({ path: "e2e-screenshots/partner-contacts.png", fullPage: true });

    // edit the role — Edit and Delete sit in the row's ⋮ menu (F71); items picked by keyboard, the toast of the
    // previous step can sit over the open menu (lessons, contracts F71)
    await row.getByRole("button", { name: "Row actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).press("Enter");
    await row.getByRole("textbox", { name: "Role" }).fill("CDO");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Contact updated")).toBeVisible();
    await expect(contacts.getByTestId("contact-row")).toContainText("CDO");

    // delete after the confirmation
    await contacts.getByTestId("contact-row").getByRole("button", { name: "Row actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).press("Enter");
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Contact deleted")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Contacts 0", exact: true })).toBeVisible();
    await expect(contacts.getByText("No contact persons yet.")).toBeVisible();
  });
});
