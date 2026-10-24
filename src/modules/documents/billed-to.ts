// Who an invoice is addressed to, against the company (D53): read from the OCR (`customerName`, `customerTaxId`),
// compared with the company profile and its VAT registrations. A warning for the owner, never a block. Pure.

import type { BilledToCheck, CompanyIdentity } from "./types";

export type { BilledToCheck, CompanyIdentity };

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const digits = (s: string) => s.replace(/\D+/g, "");
const vatKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");

/**
 * `match` when the printed name contains the company's name (or the reverse) or the printed VAT number is one of the
 * company's — or carries its organisation number (SE VAT = SE + org no + 01); `mismatch` when something was printed
 * and nothing fits; `unknown` when the document names no customer.
 */
export function checkBilledTo(
  company: CompanyIdentity,
  billed: { customerName?: string | null; customerTaxId?: string | null },
): BilledToCheck {
  const name = billed.customerName?.trim() ? fold(billed.customerName) : "";
  const tax = billed.customerTaxId?.trim() ? vatKey(billed.customerTaxId) : "";
  if (!name && !tax) return "unknown";

  const companyName = fold(company.name);
  if (name && companyName && (name.includes(companyName) || companyName.includes(name))) {
    return "match";
  }
  if (tax) {
    if (company.vatNumbers.some((v) => vatKey(v) === tax)) return "match";
    const org = company.orgNumber ? digits(company.orgNumber) : "";
    if (org.length >= 6 && digits(tax).includes(org)) return "match";
  }
  return "mismatch";
}
