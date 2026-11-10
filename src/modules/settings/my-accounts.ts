// F187 (D84): the owner's usual BAS accounts — the ONE place that names them. Settings → BAS *Use my usual accounts*
// activates them with these *Use for* notes (confirmed — his words, F126) and the seed starts from them. The active
// set is what every BAS picker and the model's proposals offer (`basPickerOptions`), so this list is the lever.
// A leaf: no imports — the dialog (client), the service and the seed read it.

export type MyAccount = { code: string; useFor: string };

/** The owner's set (2026-11-10): taxes, VAT in both countries, his salary, the accountant, rent, subscriptions, sales. */
export const MY_ACCOUNTS: readonly MyAccount[] = [
  {
    code: "1630",
    useFor:
      "Payments to and from Skatteverket's tax account: preliminary tax, employer fees, Swedish VAT",
  },
  { code: "2650", useFor: "Swedish VAT settlement" },
  {
    code: "2890",
    useFor: "Swiss VAT owed to or paid to the Swiss tax administration (ESTV)",
  },
  { code: "3305", useFor: "Invoices to Swiss clients" },
  { code: "3308", useFor: "Invoices to EU clients" },
  { code: "5010", useFor: "Office rent" },
  {
    code: "5420",
    useFor: "Per-user software and SaaS seats: ChatGPT, AI assistants, Power BI, GitHub",
  },
  { code: "5800", useFor: "Travel: trains, flights, hotels, meals on trips" },
  {
    code: "6530",
    useFor: "The accountant: bookkeeping, payroll and payslip services",
  },
  { code: "6540", useFor: "Cloud and hosting billed on use: Azure" },
  { code: "6570", useFor: "Bank fees and card fees" },
  { code: "7220", useFor: "The owner's salary" },
  { code: "7510", useFor: "Employer social fees on the owner's salary" },
];

/**
 * Accounts the app itself writes, kept active beside the owner's set so the picker can show what was written:
 * 8310 — the default *Savings interest* rule (banking `DEFAULT_RULES`) and the *interest* no-proof reason.
 * (6570, the bank-fee rule's and the *fee* reason's account, is in the owner's set already.)
 */
export const KEPT_FOR_THE_APP: readonly MyAccount[] = [
  { code: "8310", useFor: "Interest earned on the savings account" },
];

/** Every account *Use my usual accounts* activates, in chart order. */
export const MY_ACCOUNT_SET: readonly MyAccount[] = [...MY_ACCOUNTS, ...KEPT_FOR_THE_APP].sort(
  (a, b) => a.code.localeCompare(b.code),
);
