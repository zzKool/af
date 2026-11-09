"use client";

import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { languageName } from "@/kernel/i18n/display-names";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import { CURRENCIES, SUPPORTED_LOCALES } from "@/kernel/nav/constants";
import { CountryPicker } from "@/kernel/ui/country-picker";
import { cn } from "@/lib/utils";
import { updatePartnerAction } from "@/modules/partners/partners.actions";
import { type BasOption, BasPicker } from "@/modules/settings/ui";
import { PARTNER_TYPES, type SystemRole } from "../types";

type ExternalIdentifier = { label: string; value: string };

export type PartnerData = {
  id: string;
  name: string;
  shortCode?: string | null;
  orgNumber: string | null;
  vatNumber: string | null;
  types: string[];
  defaultCurrency: string | null;
  defaultLanguage: string | null;
  defaultBasCategoryCode: string | null;
  paymentTermsDays?: number | null;
  externalIdentifiers: unknown;
  email: string | null;
  phone: string | null;
  address: unknown;
  /** F129: read-only — the migration / `ensureSystemPartners` set it; the page shows it as a tag */
  systemRole?: SystemRole | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type AddressData = {
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
};

interface PartnerFormProps {
  partner: PartnerData;
  basOptions: BasOption[];
  /** After a saved name or types change — the page's title row shows both. */
  onSaved?: (patch: { name?: string; types?: string[] }) => void;
}

// The partner's editable facts (auto-save on blur / change), in the *Edit details* dialog (the board *Partner*,
// the owner 2026-11-09): identity, address (the country by name), contact, invoicing defaults, identifiers —
// two columns on a wide screen. The page shows them read only in its *Details* card.
export function PartnerForm({ partner, basOptions, onSaved }: PartnerFormProps) {
  const [name, setName] = useState(partner.name);
  const [shortCode, setShortCode] = useState(partner.shortCode ?? "");
  const [orgNumber, setOrgNumber] = useState(partner.orgNumber ?? "");
  const [vatNumber, setVatNumber] = useState(partner.vatNumber ?? "");
  const [types, setTypes] = useState<string[]>(partner.types);
  const [defaultCurrency, setDefaultCurrency] = useState(partner.defaultCurrency ?? "");
  const [defaultLanguage, setDefaultLanguage] = useState(partner.defaultLanguage ?? "");
  const [defaultBasCategoryCode, setDefaultBasCategoryCode] = useState(
    partner.defaultBasCategoryCode ?? "",
  );
  const [paymentTermsDays, setPaymentTermsDays] = useState(
    partner.paymentTermsDays != null ? String(partner.paymentTermsDays) : "",
  );
  const [email, setEmail] = useState(partner.email ?? "");
  const [phone, setPhone] = useState(partner.phone ?? "");
  const [address, setAddress] = useState<AddressData>((partner.address as AddressData) ?? {});
  const [externalIdentifiers, setExternalIdentifiers] = useState<ExternalIdentifier[]>(
    (partner.externalIdentifiers as ExternalIdentifier[]) ?? [],
  );

  const { executeAsync: execUpdate } = useAction(updatePartnerAction);
  const t = useT();
  const lang = useUiLanguage();

  // Auto-save helper for simple fields
  const autoSave = useCallback(
    async (field: string, value: unknown) => {
      const result = await execUpdate({ id: partner.id, [field]: value });
      const error = extractError(result);
      if (error) {
        toast.error(error);
        return false;
      }
      return true;
    },
    [partner.id, execUpdate],
  );

  // onBlur handlers for text fields — send value as-is so empty string clears to null in service
  const handleBlur = useCallback(
    async (field: string, currentValue: string, originalValue: string | null) => {
      if (currentValue === (originalValue ?? "")) return;
      const ok = await autoSave(field, currentValue);
      if (ok && field === "name") onSaved?.({ name: currentValue });
    },
    [autoSave, onSaved],
  );

  // onChange handlers for selects — "__none__" sentinel clears to empty string (→ null in service)
  const handleSelectChange = useCallback(
    (field: string, value: string) => {
      const cleared = value === "__none__" ? "" : value;
      autoSave(field, cleared);
    },
    [autoSave],
  );

  // Types toggle
  const handleTypeToggle = useCallback(
    (type: string, checked: boolean) => {
      const newTypes = checked ? [...types, type] : types.filter((t) => t !== type);
      if (newTypes.length === 0) {
        toast.error(t("partners.form.typeRequired"));
        return;
      }
      setTypes(newTypes);
      void autoSave("types", newTypes).then((ok) => {
        if (ok) onSaved?.({ types: newTypes });
      });
    },
    [types, autoSave, onSaved, t],
  );

  // External identifiers save
  const handleExternalIdsSave = useCallback(() => {
    const valid = externalIdentifiers.filter((ei) => ei.label.trim() && ei.value.trim());
    setExternalIdentifiers(valid);
    autoSave("externalIdentifiers", valid);
  }, [externalIdentifiers, autoSave]);

  const addExternalIdentifier = useCallback(() => {
    if (externalIdentifiers.length >= 5) {
      toast.error(t("partners.form.identifiersMax"));
      return;
    }
    setExternalIdentifiers([...externalIdentifiers, { label: "", value: "" }]);
  }, [externalIdentifiers, t]);

  const removeExternalIdentifier = useCallback(
    (index: number) => {
      const updated = externalIdentifiers.filter((_, i) => i !== index);
      setExternalIdentifiers(updated);
      autoSave("externalIdentifiers", updated);
    },
    [externalIdentifiers, autoSave],
  );

  // the address saves as a whole, when a field is left or the country picked
  const saveAddress = useCallback(
    (next: AddressData) => {
      if (JSON.stringify(next) === JSON.stringify(partner.address ?? {})) return;
      void autoSave("address", next);
    },
    [autoSave, partner.address],
  );

  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
      <Group title={t("partners.form.identity")}>
        <Field id="name" label={t("partners.col.name")} wide>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => handleBlur("name", name, partner.name)}
          />
        </Field>
        <div className="col-span-2 flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-muted-foreground">
            {t("partners.col.types")}
          </span>
          <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1">
            {PARTNER_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={types.includes(type)}
                  onChange={(e) => handleTypeToggle(type, e.target.checked)}
                />
                {t(`partners.type.${type}`)}
              </label>
            ))}
          </div>
        </div>
        <Field id="shortCode" label={t("partners.new.shortCode")} wide>
          <Input
            id="shortCode"
            value={shortCode}
            maxLength={6}
            placeholder={t("partners.form.shortCodePlaceholder")}
            className="uppercase"
            onChange={(e) => setShortCode(e.target.value.toUpperCase())}
            onBlur={() => handleBlur("shortCode", shortCode, partner.shortCode ?? null)}
          />
        </Field>
        <Field id="orgNumber" label={t("partners.col.orgNumber")}>
          <Input
            id="orgNumber"
            value={orgNumber}
            onChange={(e) => setOrgNumber(e.target.value)}
            onBlur={() => handleBlur("orgNumber", orgNumber, partner.orgNumber)}
          />
        </Field>
        <Field id="vatNumber" label={t("partners.col.vatNumber")}>
          <Input
            id="vatNumber"
            value={vatNumber}
            onChange={(e) => setVatNumber(e.target.value)}
            onBlur={() => handleBlur("vatNumber", vatNumber, partner.vatNumber)}
          />
        </Field>
      </Group>

      <Group title={t("partners.form.address")}>
        <Field id="street" label={t("partners.form.street")} wide>
          <Input
            id="street"
            value={address.street ?? ""}
            onChange={(e) => setAddress({ ...address, street: e.target.value })}
            onBlur={() => saveAddress(address)}
          />
        </Field>
        <Field id="postalCode" label={t("partners.form.postalCode")}>
          <Input
            id="postalCode"
            value={address.postalCode ?? ""}
            onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
            onBlur={() => saveAddress(address)}
          />
        </Field>
        <Field id="city" label={t("partners.form.city")}>
          <Input
            id="city"
            value={address.city ?? ""}
            onChange={(e) => setAddress({ ...address, city: e.target.value })}
            onBlur={() => saveAddress(address)}
          />
        </Field>
        <Field id="country" label={t("partners.form.country")} wide>
          <CountryPicker
            id="country"
            value={address.country ?? ""}
            data-testid="partner-country"
            onChange={(code) => {
              const next = { ...address, country: code || undefined };
              setAddress(next);
              saveAddress(next);
            }}
          />
        </Field>
      </Group>

      <Group title={t("partners.form.contact")}>
        <Field id="email" label={t("partners.col.email")}>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => handleBlur("email", email, partner.email)}
          />
        </Field>
        <Field id="phone" label={t("partners.form.phone")}>
          <Input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => handleBlur("phone", phone, partner.phone)}
          />
        </Field>
      </Group>

      <Group title={t("partners.form.defaults")}>
        <Field id="defaultCurrency" label={t("partners.col.currency")}>
          <Select
            value={defaultCurrency || "__none__"}
            onValueChange={(v) => {
              const val = v === "__none__" || !v ? "" : v;
              setDefaultCurrency(val);
              handleSelectChange("defaultCurrency", v ?? "__none__");
            }}
          >
            <SelectTrigger id="defaultCurrency">
              <SelectValue placeholder={t("partners.form.selectCurrency")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("partners.form.none")}</SelectItem>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="defaultLanguage" label={t("partners.form.language")}>
          <Select
            value={defaultLanguage || "__none__"}
            onValueChange={(v) => {
              const val = v === "__none__" || !v ? "" : v;
              setDefaultLanguage(val);
              handleSelectChange("defaultLanguage", v ?? "__none__");
            }}
          >
            <SelectTrigger id="defaultLanguage">
              <SelectValue placeholder={t("partners.form.selectLanguage")}>
                {(v: string) =>
                  v && v !== "__none__" ? languageName(v, lang) : t("partners.form.none")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("partners.form.none")}</SelectItem>
              {SUPPORTED_LOCALES.map((l) => (
                <SelectItem key={l} value={l}>
                  {languageName(l, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="paymentTermsDays" label={t("partners.form.paymentTerms")}>
          <Input
            id="paymentTermsDays"
            type="number"
            min={0}
            max={365}
            placeholder="30"
            value={paymentTermsDays}
            onChange={(e) => setPaymentTermsDays(e.target.value)}
            onBlur={() => {
              const next = paymentTermsDays.trim() === "" ? null : Number(paymentTermsDays);
              if (next === (partner.paymentTermsDays ?? null)) return;
              void autoSave("paymentTermsDays", next);
            }}
          />
        </Field>
        <Field id="partner-default-bas" label={t("partners.form.basCategory")}>
          <BasPicker
            id="partner-default-bas"
            options={basOptions}
            value={defaultBasCategoryCode}
            onChange={(code) => {
              setDefaultBasCategoryCode(code);
              handleSelectChange("defaultBasCategoryCode", code || "__none__");
            }}
            allowNone
            noneLabel={t("partners.form.none")}
            direction="cost"
            data-testid="partner-default-bas"
          />
        </Field>
        <p className="col-span-2 -mt-2 text-xs text-muted-foreground">
          {t("partners.form.paymentTermsHint")}
        </p>
      </Group>

      <Group title={t("partners.form.identifiers")} wide>
        <div className="col-span-2 space-y-3">
          {externalIdentifiers.length === 0 && (
            <p className="text-[13px] text-muted-foreground">{t("partners.form.noIdentifiers")}</p>
          )}
          {externalIdentifiers.map((ei, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: dynamic list without stable IDs
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Label>{t("partners.form.identifierLabel")}</Label>
                <Input
                  value={ei.label}
                  onChange={(e) => {
                    const updated = [...externalIdentifiers];
                    updated[i] = { ...updated[i], label: e.target.value };
                    setExternalIdentifiers(updated);
                  }}
                  placeholder={t("partners.form.identifierLabelPlaceholder")}
                />
              </div>
              <div className="flex-1">
                <Label>{t("partners.form.identifierValue")}</Label>
                <Input
                  value={ei.value}
                  onChange={(e) => {
                    const updated = [...externalIdentifiers];
                    updated[i] = { ...updated[i], value: e.target.value };
                    setExternalIdentifiers(updated);
                  }}
                  placeholder={t("partners.form.identifierValuePlaceholder")}
                />
              </div>
              <Button variant="ghost" size="sm" onClick={() => removeExternalIdentifier(i)}>
                {t("partners.form.remove")}
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addExternalIdentifier}>
              {t("partners.form.addIdentifier")}
            </Button>
            {externalIdentifiers.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleExternalIdsSave}>
                {t("partners.form.saveIdentifiers")}
              </Button>
            )}
          </div>
        </div>
      </Group>
    </div>
  );
}

/** A titled block of the form: an eyebrow, then a two-column grid. */
function Group({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <fieldset className={cn("grid grid-cols-2 content-start gap-3", wide && "md:col-span-2")}>
      <legend className="eyebrow mb-3">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({
  id,
  label,
  wide,
  children,
}: {
  id: string;
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", wide && "col-span-2")}>
      <Label htmlFor={id} className="truncate text-[12px] font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
