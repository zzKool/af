"use client";

// The partner match card (specs/documents US1, harvest R39): the OCR vendor against the partners — *Use match*
// on the best one (shown from 60 %), the other matches, or *New supplier* pre-filled with the OCR facts (name, VAT
// number, address — documents T026), created as a vendor and selected at once. Used by the supplier-invoice and
// the expense dialogs (F87 moved it here from supplier-invoices: it only ever used partners' actions and strings).
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import type { OcrAddress } from "@/kernel/ocr/ocr";
import { createPartnerAction, matchPartnersAction } from "@/modules/partners/partners.actions";
import type { PartnerMatch } from "@/modules/partners/types";
import { ocrAddressText, partnerAddressFromOcr } from "./ocr-address";

const BEST_FROM = 60;

export type VendorFacts = {
  name?: string | null;
  vatNumber?: string | null;
  /** the OCR's vendor address (`OcrExtractedData.vendorAddress`) */
  address?: OcrAddress | null;
};

export function PartnerMatchCard({
  vendor,
  selectedId,
  onUseMatch,
  onCreated,
}: {
  vendor: VendorFacts;
  selectedId: string;
  onUseMatch: (partnerId: string) => void;
  onCreated: (partner: { id: string; name: string }) => void;
}) {
  const t = useT();
  const [matches, setMatches] = useState<PartnerMatch[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(vendor.name ?? "");
  const [vatNumber, setVatNumber] = useState(vendor.vatNumber ?? "");
  const { executeAsync: match } = useAction(matchPartnersAction);
  const { executeAsync: createPartner, isPending } = useAction(createPartnerAction);

  const addressText = ocrAddressText(vendor.address);
  const key = JSON.stringify([vendor.name ?? "", vendor.vatNumber ?? "", addressText ?? ""]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` serialises the vendor facts
  useEffect(() => {
    let live = true;
    if (!vendor.name && !vendor.vatNumber) {
      setMatches([]);
      return;
    }
    match({
      name: vendor.name ?? undefined,
      vatNumber: vendor.vatNumber ?? undefined,
      address: addressText?.slice(0, 400) ?? undefined,
      type: "vendor",
    }).then((r) => {
      if (live) setMatches(r?.data?.data ?? []);
    });
    return () => {
      live = false;
    };
  }, [key]);

  async function create() {
    const r = await createPartner({
      name: name.trim(),
      types: ["vendor"],
      vatNumber: vatNumber.trim() || undefined,
      address: partnerAddressFromOcr(vendor.address),
      externalIdentifiers: [],
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const created = r?.data?.data;
    if (created) {
      const createdName = name.trim();
      toast.success(t("partners.match.created", { name: createdName }));
      setCreating(false);
      onCreated({ id: created.id, name: createdName });
    }
  }

  if (matches === null) return null;
  const best = matches[0] && matches[0].percent >= BEST_FROM ? matches[0] : null;
  const others = best ? matches.slice(1) : matches;
  return (
    <div
      className="sm:col-span-2 rounded-md border bg-muted/40 p-3 text-sm"
      data-testid="partner-match"
    >
      <div className="font-medium">{t("partners.match.title")}</div>
      {best ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span data-testid="partner-match-best">
            {t("partners.match.best", { name: best.name, percent: best.percent })}
          </span>
          <Button
            type="button"
            size="sm"
            variant={selectedId === best.partnerId ? "secondary" : "default"}
            onClick={() => onUseMatch(best.partnerId)}
            data-testid="partner-match-use"
          >
            {t("partners.match.use")}
          </Button>
        </div>
      ) : (
        <p className="mt-1 text-muted-foreground">{t("partners.match.none")}</p>
      )}
      {others.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>{t("partners.match.other")}:</span>
          {others.map((m) => (
            <button
              type="button"
              key={m.partnerId}
              className="underline underline-offset-2"
              onClick={() => onUseMatch(m.partnerId)}
            >
              {m.name} ({m.percent} %)
            </button>
          ))}
        </div>
      )}
      {creating ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t("partners.match.vendorName")}
            placeholder={t("partners.match.vendorName")}
            data-testid="new-vendor-name"
          />
          <Input
            value={vatNumber}
            onChange={(e) => setVatNumber(e.target.value)}
            aria-label={t("partners.match.vatNumber")}
            placeholder={t("partners.match.vatNumber")}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void create()}
            disabled={isPending || !name.trim()}
            data-testid="new-vendor-create"
          >
            {t("partners.match.create")}
          </Button>
          {addressText && (
            <p
              className="text-xs text-muted-foreground sm:col-span-3"
              data-testid="new-vendor-address"
            >
              {addressText}
            </p>
          )}
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => setCreating(true)}
          data-testid="partner-match-new"
        >
          {t("partners.match.newVendor")}
        </Button>
      )}
    </div>
  );
}
