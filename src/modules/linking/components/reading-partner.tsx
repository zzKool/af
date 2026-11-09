"use client";

// The dialog's Partner block (F131, review 2026-10-31 §2 row 2.5, §6.3): the partner match card first thing — the
// best match (≥ the card's threshold) pre-picked and named with its score — the partner select under it (the memory's
// partner *remembered*, else empty: a justified row names a partner, F129), and *+ New partner from this invoice*
// opening the partners module's `PartnerCreateForm` **inline** (T023), pre-filled from the paper: name, VAT number, address, country, the
// default currency = the reading's, the type by the row's direction (vendor on an outgoing row, client on an
// incoming one), the short code empty. D70 (one partner per name / VAT number) is answered by picking the existing one.
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/kernel/i18n/use-t";
import type { OcrAddress } from "@/kernel/ocr/fields";
import {
  MATCH_BEST_FROM,
  PartnerCreateForm,
  type PartnerMatch,
  PartnerMatchCard,
} from "@/modules/partners/ui";
import { counterpartyMemoryAction } from "../linking.actions";
import type { JustifyPartner } from "./justify-panel";

export const NONE = "__none__";

export type PartnerPick = {
  partnerId: string;
  /** how the pick got there — the hint says it; `picked` is the owner's own */
  from: "match" | "memory" | "picked" | "created" | null;
  matchPercent?: number;
};

export function ReadingPartnerBlock({
  rowId,
  incoming,
  vendor,
  readingCurrency,
  partners,
  pick,
  onPick,
  onPropose,
  onCreated,
  paperWord,
  disabled,
}: {
  rowId: string;
  /** an incoming row's counterparty is a client; an outgoing row's a vendor */
  incoming: boolean;
  /** the paper's vendor facts as edited in the dialog */
  vendor: { name: string | null; vatNumber: string | null; address: OcrAddress | null };
  readingCurrency: string | null;
  partners: JustifyPartner[];
  pick: PartnerPick | null;
  /** the owner's own pick (or none) */
  onPick: (pick: PartnerPick | null) => void;
  /** a proposal from a fact — a match or the memory; the host keeps an existing pick (a match replaces the memory's) */
  onPropose: (pick: PartnerPick) => void;
  /** a partner the form created: the host adds it to its list and picks it */
  onCreated: (partner: JustifyPartner) => void;
  /** *invoice* / *receipt* — the button's word */
  paperWord: string;
  disabled?: boolean;
}) {
  const t = useT();
  const ids = useId();
  const [creating, setCreating] = useState(false);
  const [best, setBest] = useState<PartnerMatch | null>(null);
  const [remembered, setRemembered] = useState<{ id: string; name: string; count: number } | null>(
    null,
  );
  const autoPicked = useRef(false);
  const { executeAsync: loadMemory } = useAction(counterpartyMemoryAction);

  // the counterparty memory (F116 US3): the partner this key was linked to most often — proposed when no match did
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per row — the proposal must not override a later pick
  useEffect(() => {
    let live = true;
    void loadMemory({ bankTransactionId: rowId }).then((r) => {
      const result = r?.data;
      const list = result && "data" in result ? result.data : [];
      const top = list.find((m) => partners.some((p) => p.id === m.partnerId));
      if (!live || !top) return;
      setRemembered({ id: top.partnerId, name: top.name, count: top.count });
      onPropose({ partnerId: top.partnerId, from: "memory" });
    });
    return () => {
      live = false;
    };
  }, [rowId]);

  // the best match ≥ the threshold is pre-picked once, as a proposal — a VAT number or a name is a fact (F124)
  function onMatches(matches: PartnerMatch[]) {
    const top = matches[0] && matches[0].percent >= MATCH_BEST_FROM ? matches[0] : null;
    setBest(top);
    if (!top || autoPicked.current) return;
    autoPicked.current = true;
    onPropose({ partnerId: top.partnerId, from: "match", matchPercent: top.percent });
  }

  const picked = pick ? partners.find((p) => p.id === pick.partnerId) : undefined;
  const hint = !pick
    ? t("linking.reading.partnerEmpty")
    : pick.from === "match" && best && pick.partnerId === best.partnerId
      ? t("linking.reading.partnerMatched", { name: best.name, percent: best.percent })
      : pick.from === "memory" && remembered && pick.partnerId === remembered.id
        ? t("linking.reading.partnerRemembered", {
            name: remembered.name,
            count: String(remembered.count),
          })
        : null;

  return (
    <div className="flex flex-col gap-2" data-testid="reading-partner">
      {creating ? (
        <PartnerCreateForm
          initial={{
            name: vendor.name,
            vatNumber: vendor.vatNumber,
            address: vendor.address,
            currency: readingCurrency,
          }}
          type={incoming ? "client" : "vendor"}
          title={t("linking.reading.newPartner.title", { paper: paperWord })}
          hint={t("linking.reading.newPartner.prefilled")}
          testIdPrefix="reading-new-partner"
          onCancel={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            onCreated({ ...p, defaultBasCode: null, systemRole: null });
          }}
          onExisting={(id) => {
            setCreating(false);
            onPick({ partnerId: id, from: "picked" });
          }}
        />
      ) : (
        (vendor.name || vendor.vatNumber) && (
          <PartnerMatchCard
            vendor={{ name: vendor.name, vatNumber: vendor.vatNumber, address: vendor.address }}
            selectedId={pick?.partnerId ?? ""}
            onUseMatch={(id) =>
              onPick({
                partnerId: id,
                from: best && id === best.partnerId ? "match" : "picked",
                ...(best && id === best.partnerId ? { matchPercent: best.percent } : {}),
              })
            }
            onCreated={(p) =>
              onCreated({
                id: p.id,
                name: p.name,
                defaultBasCode: null,
                types: [incoming ? "client" : "vendor"],
                systemRole: null,
                vatNumber: null,
              })
            }
            onMatches={onMatches}
            onNew={() => setCreating(true)}
            newLabel={t("linking.reading.newPartner", { paper: paperWord })}
          />
        )
      )}
      {!creating && (
        <div>
          <label htmlFor={`${ids}-partner`} className="sr-only">
            {t("linking.reading.partnerLabel")}
          </label>
          <Select
            value={pick?.partnerId ?? NONE}
            onValueChange={(v) => onPick(v && v !== NONE ? { partnerId: v, from: "picked" } : null)}
            disabled={disabled}
          >
            <SelectTrigger id={`${ids}-partner`} className="w-full" data-testid="justify-partner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("linking.justify.field.noPartner")}</SelectItem>
              {partners.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!(vendor.name || vendor.vatNumber) && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => setCreating(true)}
              data-testid="partner-match-new"
            >
              {t("linking.reading.newPartner", { paper: paperWord })}
            </Button>
          )}
          {hint && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="justify-partner-hint">
              {hint}
            </p>
          )}
          {pick && !picked && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("linking.reading.partnerEmpty")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
