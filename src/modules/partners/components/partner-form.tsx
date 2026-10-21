"use client";

import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { useT } from "@/kernel/i18n/use-t";
import { CURRENCIES, SUPPORTED_LOCALES } from "@/kernel/nav/constants";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  deactivatePartnerAction,
  reactivatePartnerAction,
  updatePartnerAction,
} from "@/modules/partners/partners.actions";

type BasOption = { code: string; label: string };

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
  hideHeader?: boolean;
  onNameSaved?: (name: string) => void;
}

export function PartnerForm({
  partner,
  basOptions,
  hideHeader = false,
  onNameSaved,
}: PartnerFormProps) {
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
  const [isActive, setIsActive] = useState(partner.isActive);

  const { executeAsync: execUpdate } = useAction(updatePartnerAction);
  const { executeAsync: execDeactivate } = useAction(deactivatePartnerAction);
  const { executeAsync: execReactivate } = useAction(reactivatePartnerAction);

  const t = useT();
  const { dialogProps, confirm } = useConfirmDialog({
    title: t("partners.deactivateConfirm.title"),
    variant: "destructive",
    confirmLabel: t("partners.deactivate"),
  });

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
      if (ok && field === "name" && onNameSaved) {
        onNameSaved(currentValue);
      }
    },
    [autoSave, onNameSaved],
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
      autoSave("types", newTypes);
    },
    [types, autoSave, t],
  );

  // Address save
  const handleAddressSave = useCallback(() => {
    autoSave("address", address);
  }, [address, autoSave]);

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

  const handleDeactivate = useCallback(() => {
    confirm(
      async () => {
        const result = await execDeactivate({ id: partner.id });
        const error = extractError(result);
        if (error) throw new Error(error);
        setIsActive(false);
        toast.success(t("partners.deactivated", { name }));
      },
      {
        description: t("partners.deactivateConfirm.description", { name }),
      },
    );
  }, [confirm, execDeactivate, partner.id, name, t]);

  const handleReactivate = useCallback(async () => {
    const result = await execReactivate({ id: partner.id });
    const error = extractError(result);
    if (error) {
      toast.error(error);
      return;
    }
    setIsActive(true);
    toast.success(t("partners.reactivated", { name }));
  }, [execReactivate, partner.id, name, t]);

  return (
    <div className="space-y-6">
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/partners" className="text-muted-foreground hover:text-foreground">
              &larr; {t("partners.title")}
            </Link>
            <h1 className="text-2xl font-semibold">{name}</h1>
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? t("partners.status.active") : t("partners.status.inactive")}
            </Badge>
          </div>
          {isActive ? (
            <Button variant="destructive" size="sm" onClick={handleDeactivate}>
              {t("partners.deactivate")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handleReactivate}>
              {t("partners.reactivate")}
            </Button>
          )}
        </div>
      )}

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>{t("partners.form.basic")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">{t("partners.col.name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => handleBlur("name", name, partner.name)}
            />
          </div>
          <div>
            <Label>{t("partners.col.types")}</Label>
            <div className="flex gap-3 pt-2">
              {(["client", "vendor", "employee"] as const).map((type) => (
                <label key={type} className="flex items-center gap-1.5 text-sm">
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
          <div>
            <Label htmlFor="shortCode">{t("partners.new.shortCode")}</Label>
            <Input
              id="shortCode"
              value={shortCode}
              maxLength={6}
              placeholder={t("partners.form.shortCodePlaceholder")}
              className="uppercase"
              onChange={(e) => setShortCode(e.target.value.toUpperCase())}
              onBlur={() => handleBlur("shortCode", shortCode, partner.shortCode ?? null)}
            />
          </div>
          <div>
            <Label htmlFor="orgNumber">{t("partners.col.orgNumber")}</Label>
            <Input
              id="orgNumber"
              value={orgNumber}
              onChange={(e) => setOrgNumber(e.target.value)}
              onBlur={() => handleBlur("orgNumber", orgNumber, partner.orgNumber)}
            />
          </div>
          <div>
            <Label htmlFor="vatNumber">{t("partners.col.vatNumber")}</Label>
            <Input
              id="vatNumber"
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              onBlur={() => handleBlur("vatNumber", vatNumber, partner.vatNumber)}
            />
          </div>
          <div>
            <Label htmlFor="email">{t("partners.col.email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => handleBlur("email", email, partner.email)}
            />
          </div>
          <div>
            <Label htmlFor="phone">{t("partners.form.phone")}</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => handleBlur("phone", phone, partner.phone)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Defaults */}
      <Card>
        <CardHeader>
          <CardTitle>{t("partners.form.defaults")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>{t("partners.col.currency")}</Label>
            <Select
              value={defaultCurrency || "__none__"}
              onValueChange={(v) => {
                const val = v === "__none__" || !v ? "" : v;
                setDefaultCurrency(val);
                handleSelectChange("defaultCurrency", v ?? "__none__");
              }}
            >
              <SelectTrigger>
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
          </div>
          <div>
            <Label>{t("partners.form.language")}</Label>
            <Select
              value={defaultLanguage || "__none__"}
              onValueChange={(v) => {
                const val = v === "__none__" || !v ? "" : v;
                setDefaultLanguage(val);
                handleSelectChange("defaultLanguage", v ?? "__none__");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("partners.form.selectLanguage")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("partners.form.none")}</SelectItem>
                {SUPPORTED_LOCALES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("partners.form.basCategory")}</Label>
            <Select
              value={defaultBasCategoryCode || "__none__"}
              onValueChange={(v) => {
                const val = v === "__none__" || !v ? "" : v;
                setDefaultBasCategoryCode(val);
                handleSelectChange("defaultBasCategoryCode", v ?? "__none__");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("partners.form.selectBas")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("partners.form.none")}</SelectItem>
                {basOptions.map((o) => (
                  <SelectItem key={o.code} value={o.code}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="paymentTermsDays">{t("partners.form.paymentTerms")}</Label>
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
            <p className="mt-1 text-xs text-muted-foreground">
              {t("partners.form.paymentTermsHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Address */}
      <Card>
        <CardHeader>
          <CardTitle>{t("partners.form.address")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="street">{t("partners.form.street")}</Label>
              <Input
                id="street"
                value={address.street ?? ""}
                onChange={(e) => setAddress({ ...address, street: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="city">{t("partners.form.city")}</Label>
              <Input
                id="city"
                value={address.city ?? ""}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="postalCode">{t("partners.form.postalCode")}</Label>
              <Input
                id="postalCode"
                value={address.postalCode ?? ""}
                onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="country">{t("partners.form.country")}</Label>
              <Input
                id="country"
                value={address.country ?? ""}
                onChange={(e) => setAddress({ ...address, country: e.target.value })}
                maxLength={2}
              />
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleAddressSave}>
            {t("partners.form.saveAddress")}
          </Button>
        </CardContent>
      </Card>

      {/* External Identifiers */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("partners.form.identifiers")}</CardTitle>
            <Button variant="outline" size="sm" onClick={addExternalIdentifier}>
              {t("partners.form.addIdentifier")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {externalIdentifiers.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("partners.form.noIdentifiers")}</p>
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
          {externalIdentifiers.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleExternalIdsSave}>
              {t("partners.form.saveIdentifiers")}
            </Button>
          )}
        </CardContent>
      </Card>

      {!hideHeader && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}
