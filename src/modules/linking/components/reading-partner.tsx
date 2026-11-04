"use client";

// The dialog's Partner block (F131, review 2026-10-31 §2 row 2.5, §6.3): the partner match card first thing — the
// best match (≥ the card's threshold) pre-picked and named with its score — the partner select under it (the memory's
// partner *remembered*, else empty: a justified row names a partner, F129), and *+ New partner from this invoice*
// opening the full partner form **inline**, pre-filled from the paper: name, VAT number, address, country, the
// default currency = the reading's, the type by the row's direction (vendor on an outgoing row, client on an
// incoming one), the short code empty. D70 (one partner per name / VAT number) is answered by picking the existing one.
import { useAction } from "next-safe-action/hooks";
import { type ComponentProps, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { CURRENCIES } from "@/kernel/nav/constants";
import type { OcrAddress } from "@/kernel/ocr/fields";
import {
  createPartnerAction,
  MATCH_BEST_FROM,
  type PartnerMatch,
  PartnerMatchCard,
  partnerAddressFromOcr,
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
        <NewPartnerForm
          vendor={vendor}
          incoming={incoming}
          readingCurrency={readingCurrency}
          paperWord={paperWord}
          onCancel={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            onCreated(p);
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
          <label htmlFor={`${ids}-partner`} className="mb-1 block text-xs font-medium">
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

/**
 * The full partner form, inline, pre-filled from the paper — the partners module's create action with every field
 * the paper gives (`createPartnerSchema`), the short code left empty on purpose. A duplicate (D70) picks the existing
 * partner instead of failing.
 */
function NewPartnerForm({
  vendor,
  incoming,
  readingCurrency,
  paperWord,
  onCancel,
  onCreated,
  onExisting,
}: {
  vendor: { name: string | null; vatNumber: string | null; address: OcrAddress | null };
  incoming: boolean;
  readingCurrency: string | null;
  paperWord: string;
  onCancel: () => void;
  onCreated: (partner: JustifyPartner) => void;
  onExisting: (partnerId: string) => void;
}) {
  const t = useT();
  const ids = useId();
  const fromOcr = partnerAddressFromOcr(vendor.address);
  const [name, setName] = useState(vendor.name ?? "");
  const [shortCode, setShortCode] = useState("");
  const [vatNumber, setVatNumber] = useState(vendor.vatNumber ?? "");
  const [orgNumber, setOrgNumber] = useState("");
  const [street, setStreet] = useState(fromOcr.street ?? "");
  const [postalCode, setPostalCode] = useState(fromOcr.postalCode ?? "");
  const [city, setCity] = useState(fromOcr.city ?? "");
  const [country, setCountry] = useState(fromOcr.country ?? "");
  const currencyRead = (CURRENCIES as readonly string[]).includes(readingCurrency ?? "")
    ? (readingCurrency as string)
    : "";
  const [currency, setCurrency] = useState(currencyRead);
  const type = incoming ? "client" : "vendor";
  const { executeAsync: createPartner, isPending } = useAction(createPartnerAction);

  async function create() {
    const address = { street, postalCode, city, country: country.toUpperCase() };
    const r = await createPartner({
      name: name.trim(),
      shortCode: shortCode.trim().toUpperCase(),
      types: [type],
      vatNumber: vatNumber.trim() || undefined,
      orgNumber: orgNumber.trim() || undefined,
      defaultCurrency: currency ? (currency as (typeof CURRENCIES)[number]) : undefined,
      address: Object.fromEntries(Object.entries(address).filter(([, v]) => v.trim() !== "")),
      externalIdentifiers: [],
    });
    const error = extractError(r);
    if (error) {
      const existing = duplicateOf(r);
      if (existing) {
        toast.message(t("partners.match.exists", { name: existing.name }));
        onExisting(existing.id);
        return;
      }
      toast.error(error);
      return;
    }
    const created = r?.data && "data" in r.data ? r.data.data : undefined;
    if (!created) return;
    toast.success(t("partners.match.created", { name: name.trim() }));
    onCreated({
      id: created.id,
      name: name.trim(),
      defaultBasCode: null,
      types: [type],
      systemRole: null,
      vatNumber: vatNumber.trim() || null,
    });
  }

  const field = (key: string, label: string, control: ReactNode, className = "") => (
    <div className={className}>
      <label htmlFor={`${ids}-${key}`} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      {control}
    </div>
  );
  const text = (
    key: string,
    value: string,
    set: (v: string) => void,
    extra: Partial<ComponentProps<typeof Input>> = {},
  ) => (
    <Input
      id={`${ids}-${key}`}
      value={value}
      onChange={(e) => set(e.target.value)}
      data-testid={`reading-new-partner-${key}`}
      {...extra}
    />
  );

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm"
      data-testid="reading-new-partner"
    >
      <div className="text-xs font-medium">
        {t("linking.reading.newPartner.title", { paper: paperWord })}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
        {field("name", t("linking.reading.newPartner.name"), text("name", name, setName))}
        {field(
          "short",
          t("linking.reading.newPartner.shortCode"),
          text("short", shortCode, (v) => setShortCode(v.toUpperCase()), {
            maxLength: 6,
            className: "uppercase",
          }),
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {field(
          "vat",
          t("linking.reading.newPartner.vatNumber"),
          text("vat", vatNumber, setVatNumber),
        )}
        {field(
          "org",
          t("linking.reading.newPartner.orgNumber"),
          text("org", orgNumber, setOrgNumber),
        )}
        {field(
          "street",
          t("linking.reading.newPartner.street"),
          text("street", street, setStreet),
          "sm:col-span-2",
        )}
        {field(
          "postal",
          t("linking.reading.newPartner.postalCode"),
          text("postal", postalCode, setPostalCode),
        )}
        {field("city", t("linking.reading.newPartner.city"), text("city", city, setCity))}
        {field(
          "country",
          t("linking.reading.newPartner.country"),
          text("country", country, (v) => setCountry(v.toUpperCase()), {
            maxLength: 2,
            className: "uppercase",
          }),
        )}
        {field(
          "currency",
          t("linking.reading.newPartner.currency"),
          <Select
            value={currency || NONE}
            onValueChange={(v) => setCurrency(v && v !== NONE ? v : "")}
          >
            <SelectTrigger id={`${ids}-currency`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>,
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("linking.reading.newPartner.types")}: {t(`partners.type.${type}`)} ·{" "}
        {t("linking.reading.newPartner.prefilled")}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => void create()}
          disabled={isPending || !name.trim()}
          data-testid="reading-new-partner-create"
        >
          {t("linking.reading.newPartner.create")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** The existing partner a `DUPLICATE_ENTRY` names (`details.existingId` / `existingName`, D70); null otherwise. */
function duplicateOf(result: unknown): { id: string; name: string } | null {
  const err = (
    result as { data?: { error?: { code?: string; details?: Record<string, unknown> } } }
  )?.data?.error;
  if (err?.code !== "DUPLICATE_ENTRY") return null;
  const id = err.details?.existingId;
  const name = err.details?.existingName;
  return typeof id === "string" && typeof name === "string" ? { id, name } : null;
}
