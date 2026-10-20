// VAT treatment of a client document (D23) — pure, client-safe (the editor recomputes it when the registration
// changes). The registration on the contract and the client's country decide the default line rate and the
// printed sentence: CH registration → Swiss client at the standard rate, foreign client 0 % (export, ref 221);
// SE registration → Swedish client at the standard rate, EU business with a VAT number 0 % (reverse charge),
// anywhere else 0 % (export); any other registration → its standard rate.
import { Prisma } from "@/generated/prisma/browser";

const D = Prisma.Decimal;

export type Registration = {
  id: string;
  country: string;
  vatNumber: string;
  rateSchedule: unknown;
};

const SWISS = new Set(["ch", "che", "switzerland", "suisse", "schweiz", "svizzera"]);
const SWEDISH = new Set(["se", "swe", "sweden", "sverige", "suède"]);
const EU = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

function norm(country: string | null | undefined): string {
  return (country ?? "").trim().toLowerCase();
}
export const isSwissCountry = (c: string | null | undefined): boolean =>
  norm(c) === "" || SWISS.has(norm(c));
export const isSwedishCountry = (c: string | null | undefined): boolean =>
  norm(c) === "" || SWEDISH.has(norm(c));

export function registrationRates(reg: Registration | null | undefined): string[] {
  const schedule = reg?.rateSchedule as { rates?: unknown } | null | undefined;
  const list = Array.isArray(schedule?.rates) ? schedule.rates : [];
  return list.filter((r): r is number => typeof r === "number").map((r) => new D(r).toString());
}

export type VatTreatment = "standard" | "reverse_charge" | "export" | "none";

export function vatTreatmentFor(
  reg: Registration | null | undefined,
  partner: { address: { country?: string } | null; vatNumber: string | null },
): { treatment: VatTreatment; rate: string; rates: string[] } {
  const rateList = registrationRates(reg);
  const standard = rateList[0] ?? "0";
  if (!reg) return { treatment: "none", rate: "0", rates: [] };
  const country = partner.address?.country ?? null;
  const code = (country ?? "").trim().toUpperCase();
  if (reg.country === "CH") {
    return isSwissCountry(country)
      ? { treatment: "standard", rate: standard, rates: rateList }
      : { treatment: "export", rate: "0", rates: rateList };
  }
  if (reg.country === "SE") {
    if (isSwedishCountry(country))
      return { treatment: "standard", rate: standard, rates: rateList };
    if (EU.has(code) && partner.vatNumber)
      return { treatment: "reverse_charge", rate: "0", rates: rateList };
    return { treatment: "export", rate: "0", rates: rateList };
  }
  return { treatment: "standard", rate: standard, rates: rateList };
}
