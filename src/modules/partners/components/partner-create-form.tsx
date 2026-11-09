"use client";

// The partner create form, inline (T023 — one form, lessons *F125 build*: two copies drift): every field
// `createPartnerSchema` takes that a paper or a host can give — name, short code (left empty on purpose: the owner
// picks it), VAT and org. numbers, the address, the default currency — pre-filled from `initial`, the one type the
// host names. A duplicate (D70: one partner per name / VAT number) hands back the existing partner instead of
// failing. Used by the reading dialog's *+ New partner from this invoice* (linking); the host keeps the title and
// what happens next.
import { useAction } from "next-safe-action/hooks";
import { type ComponentProps, type ReactNode, useId, useState } from "react";
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
import { createPartnerAction } from "@/modules/partners/partners.actions";
import type { PartnerType } from "../types";
import { partnerAddressFromOcr } from "./ocr-address";

const NONE = "__none__";

/** What the form was created with — the host's facts (a paper's vendor), each optional. */
export type PartnerCreateInitial = {
  name?: string | null;
  vatNumber?: string | null;
  address?: OcrAddress | null;
  /** a currency code; one the app does not know is dropped */
  currency?: string | null;
};

/** The partner just created, as a host's list needs it. */
export type CreatedPartner = {
  id: string;
  name: string;
  types: PartnerType[];
  vatNumber: string | null;
};

export function PartnerCreateForm({
  initial,
  type,
  title,
  hint,
  testIdPrefix = "partner-create",
  onCancel,
  onCreated,
  onExisting,
}: {
  initial: PartnerCreateInitial;
  /** the one type the new partner gets (the reading dialog: vendor on an outgoing row, client on an incoming one) */
  type: PartnerType;
  title: ReactNode;
  /** a line after the type: where the values came from (the reading dialog: *pre-filled from the paper*) */
  hint?: ReactNode;
  /** `{prefix}` on the form, `{prefix}-{field}` on each input, `{prefix}-create` on the button */
  testIdPrefix?: string;
  onCancel: () => void;
  onCreated: (partner: CreatedPartner) => void;
  /** D70: the partner of that name / VAT number exists — the host picks it */
  onExisting: (partnerId: string) => void;
}) {
  const t = useT();
  const ids = useId();
  const fromOcr = partnerAddressFromOcr(initial.address ?? null);
  const [name, setName] = useState(initial.name ?? "");
  const [shortCode, setShortCode] = useState("");
  const [vatNumber, setVatNumber] = useState(initial.vatNumber ?? "");
  const [orgNumber, setOrgNumber] = useState("");
  const [street, setStreet] = useState(fromOcr.street ?? "");
  const [postalCode, setPostalCode] = useState(fromOcr.postalCode ?? "");
  const [city, setCity] = useState(fromOcr.city ?? "");
  const [country, setCountry] = useState(fromOcr.country ?? "");
  const currencyRead = (CURRENCIES as readonly string[]).includes(initial.currency ?? "")
    ? (initial.currency as string)
    : "";
  const [currency, setCurrency] = useState(currencyRead);
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
      types: [type],
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
      data-testid={`${testIdPrefix}-${key}`}
      {...extra}
    />
  );

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm"
      data-testid={testIdPrefix}
    >
      <div className="text-xs font-medium">{title}</div>
      <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
        {field("name", t("partners.createForm.name"), text("name", name, setName))}
        {field(
          "short",
          t("partners.createForm.shortCode"),
          text("short", shortCode, (v) => setShortCode(v.toUpperCase()), {
            maxLength: 6,
            className: "uppercase",
          }),
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {field("vat", t("partners.createForm.vatNumber"), text("vat", vatNumber, setVatNumber))}
        {field("org", t("partners.createForm.orgNumber"), text("org", orgNumber, setOrgNumber))}
        {field(
          "street",
          t("partners.createForm.street"),
          text("street", street, setStreet),
          "sm:col-span-2",
        )}
        {field(
          "postal",
          t("partners.createForm.postalCode"),
          text("postal", postalCode, setPostalCode),
        )}
        {field("city", t("partners.createForm.city"), text("city", city, setCity))}
        {field(
          "country",
          t("partners.createForm.country"),
          text("country", country, (v) => setCountry(v.toUpperCase()), {
            maxLength: 2,
            className: "uppercase",
          }),
        )}
        {field(
          "currency",
          t("partners.createForm.currency"),
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
        {t("partners.createForm.types")}: {t(`partners.type.${type}`)}
        {hint ? <> · {hint}</> : null}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => void create()}
          disabled={isPending || !name.trim()}
          data-testid={`${testIdPrefix}-create`}
        >
          {t("partners.createForm.create")}
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
