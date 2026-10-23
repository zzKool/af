// The OCR's vendor address on its way into the partners module (documents T026, FR-003, US1/AC4): the text the
// supplier match scores, and the address *Create new partner* is pre-filled with. Pure — the dialogs import it.
import type { OcrAddress } from "@/kernel/ocr/ocr";
import type { PartnerAddress } from "./types";

const cut = (s: string | undefined, max: number) => {
  const t = s?.trim();
  return t ? t.slice(0, max) : undefined;
};

/** What the match compares: the address as printed, else its parts in postal order; null when there is none. */
export function ocrAddressText(address: OcrAddress | null | undefined): string | null {
  if (!address) return null;
  if (address.text?.trim()) return address.text.trim();
  const parts = [
    address.street?.trim(),
    [address.postalCode?.trim(), address.city?.trim()].filter(Boolean).join(" "),
    address.country?.trim(),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** The partner address the new vendor starts with — within the partner schema's limits, the country only as ISO-2. */
export function partnerAddressFromOcr(address: OcrAddress | null | undefined): PartnerAddress {
  if (!address) return {};
  const country = address.country?.trim().toUpperCase();
  const out: PartnerAddress = {
    street: cut(address.street, 200),
    postalCode: cut(address.postalCode, 20),
    city: cut(address.city, 100),
    country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
  };
  return Object.fromEntries(
    Object.entries(out).filter(([, v]) => v !== undefined),
  ) as PartnerAddress;
}
