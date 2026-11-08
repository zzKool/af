// Ready to send? (F143, Pulse phase 7; the board *Invoice studio*): what an invoice needs before it goes to the
// client, checked on the draft as the owner types — each line *ok*, *warn* (it will go, but look) or *todo* (issue
// would refuse it, or the client could not pay). Pure, client-safe: the editor re-runs it on every change.
import type { VatTreatment } from "./vat-treatment";

export type ReadyState = "ok" | "warn" | "todo";
export type ReadyKey =
  | "client"
  | "lines"
  | "period"
  | "references"
  | "vat"
  | "bank"
  | "rate"
  | "company";
export type ReadyItem = { key: ReadyKey; state: ReadyState; params?: Record<string, string> };

export type ReadyFacts = {
  type: "invoice" | "quote" | "credit_note";
  /** the client's short code — the number's series needs it (`VA26-INV-001`) */
  partnerShortCode: string | null;
  lines: readonly { description: string; quantity: string; unitPrice: string }[];
  periodLabel: string | null;
  /** the printed references (PO number, supplier number…) the contract and the client ask for */
  references: readonly { label: string; value: string }[];
  /** the document's VAT registration (`CH`, `SE`) and the treatment it gives this client */
  registration: { country: string } | null;
  treatment: VatTreatment;
  vatRates: readonly string[];
  currency: string;
  /** the bank account printed on the page: its currency and whether it has an IBAN */
  bank: { currency: string; iban: string | null } | null;
  /** the ECB rate of the issue date is stored (or the invoice is in the base) — issue refuses without it */
  rateKnown: boolean;
  /** F146: the company's e-mail / website missing from Settings → Company (the footer prints only the name) */
  companyMissing?: readonly string[];
};

const positive = (v: string) => Number.isFinite(Number(v)) && Number(v) > 0;

export function readyToSend(f: ReadyFacts): { items: ReadyItem[]; ok: number; ready: boolean } {
  const items: ReadyItem[] = [];
  items.push({ key: "client", state: f.partnerShortCode ? "ok" : "todo" });
  const lineOk =
    f.lines.length > 0 &&
    f.lines.every(
      (l) => l.description.trim() !== "" && positive(l.quantity) && positive(l.unitPrice),
    );
  items.push({ key: "lines", state: lineOk ? "ok" : "todo" });
  if (f.type === "invoice")
    items.push({ key: "period", state: f.periodLabel?.trim() ? "ok" : "warn" });
  if (f.references.length > 0) {
    const missing = f.references.filter((r) => !r.value.trim()).map((r) => r.label);
    items.push({
      key: "references",
      state: missing.length === 0 ? "ok" : "todo",
      params: {
        list: (missing.length ? missing : f.references.map((r) => `${r.label} ${r.value}`)).join(
          ", ",
        ),
      },
    });
  }
  const rates = f.vatRates.filter((r) => Number(r) > 0);
  items.push({
    key: "vat",
    state: f.registration ? "ok" : "warn",
    params: {
      country: f.registration?.country ?? "",
      treatment: f.treatment,
      rate: rates.length ? `${rates.join(" / ")} %` : "0 %",
    },
  });
  items.push({
    key: "bank",
    state: !f.bank || !f.bank.iban ? "todo" : f.bank.currency === f.currency ? "ok" : "warn",
    params: { currency: f.bank?.currency ?? f.currency },
  });
  items.push({ key: "rate", state: f.rateKnown ? "ok" : "todo", params: { currency: f.currency } });
  if (f.companyMissing)
    items.push(
      f.companyMissing.length === 0
        ? { key: "company", state: "ok" }
        : { key: "company", state: "warn", params: { list: f.companyMissing.join(", ") } },
    );
  const ok = items.filter((i) => i.state === "ok").length;
  return { items, ok, ready: items.every((i) => i.state !== "todo") };
}
