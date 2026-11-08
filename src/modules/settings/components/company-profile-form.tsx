"use client";

import { Loader2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/kernel/i18n/use-t";
import { CompanyAvatar } from "@/kernel/ui/company-avatar";
import { updateTenantProfileAction } from "@/modules/settings/settings.actions";

type ProfileData = {
  name: string;
  orgNumber: string;
  address: string;
  email: string;
  website: string;
  phone: string;
  currency: string;
};

const CURRENCIES = ["SEK", "CHF", "EUR", "USD"] as const;

export function CompanyProfileForm({
  initialData,
  initialLogo = null,
}: {
  initialData: ProfileData;
  /** F145: the logo on top of invoices (a data URL) */
  initialLogo?: string | null;
}) {
  const t = useT();
  const [data, setData] = useState(initialData);
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileData, string>>>({});
  const [savingField, setSavingField] = useState<string | null>(null);
  const previousData = useRef(initialData);

  const { executeAsync } = useAction(updateTenantProfileAction);

  const saveField = useCallback(
    async (field: keyof ProfileData, value: string) => {
      if (value === previousData.current[field]) return;

      // Validate required fields
      if (field === "name" && !value.trim()) {
        setErrors((prev) => ({ ...prev, name: t("settings.company.nameRequired") }));
        setData((prev) => ({ ...prev, name: previousData.current.name }));
        return;
      }

      setSavingField(field);
      setErrors((prev) => ({ ...prev, [field]: undefined }));

      const input: Record<string, string | null> = {
        [field]: value || null,
      };

      const result = await executeAsync(input);

      if (result?.serverError || result?.data?.error) {
        const errorMsg =
          result?.serverError?.message ??
          result?.data?.error?.message ??
          t("settings.company.saveFailed");
        setErrors((prev) => ({ ...prev, [field]: errorMsg }));
        setData((prev) => ({ ...prev, [field]: previousData.current[field] }));
      } else {
        previousData.current = { ...previousData.current, [field]: value };
      }

      setSavingField(null);
    },
    [executeAsync, t],
  );

  return (
    <div className="space-y-8">
      {/* Company Avatar */}
      <div className="flex items-center gap-4">
        <CompanyAvatar name={data.name} className="h-16 w-16 text-lg" />
        <div>
          <p className="text-lg font-medium">{data.name}</p>
          <p className="text-sm text-muted-foreground">Company initials</p>
        </div>
      </div>

      <LogoField initial={initialLogo} />

      {/* Company Name */}
      <FieldWrapper
        label={t("settings.company.name")}
        required
        error={errors.name}
        saving={savingField === "name"}
      >
        <Input
          value={data.name}
          onChange={(e) => setData((prev) => ({ ...prev, name: e.target.value }))}
          onBlur={() => saveField("name", data.name)}
          placeholder={t("settings.company.namePlaceholder")}
        />
      </FieldWrapper>

      {/* Org Number */}
      <FieldWrapper
        label={t("settings.company.orgNumber")}
        error={errors.orgNumber}
        saving={savingField === "orgNumber"}
      >
        <Input
          value={data.orgNumber}
          onChange={(e) => setData((prev) => ({ ...prev, orgNumber: e.target.value }))}
          onBlur={() => saveField("orgNumber", data.orgNumber)}
          placeholder={t("settings.company.orgNumberPlaceholder")}
        />
      </FieldWrapper>

      {/* Address */}
      <FieldWrapper
        label={t("settings.company.address")}
        error={errors.address}
        saving={savingField === "address"}
      >
        <Input
          value={data.address}
          onChange={(e) => setData((prev) => ({ ...prev, address: e.target.value }))}
          onBlur={() => saveField("address", data.address)}
          placeholder={t("settings.company.addressPlaceholder")}
        />
      </FieldWrapper>

      {/* Contact line — printed on invoices */}
      <FieldWrapper
        label={t("settings.company.email")}
        error={errors.email}
        saving={savingField === "email"}
        hint={t("settings.company.emailHint")}
      >
        <Input
          type="email"
          value={data.email}
          onChange={(e) => setData((prev) => ({ ...prev, email: e.target.value }))}
          onBlur={() => saveField("email", data.email)}
          placeholder={t("settings.company.emailPlaceholder")}
        />
      </FieldWrapper>
      <FieldWrapper
        label={t("settings.company.website")}
        error={errors.website}
        saving={savingField === "website"}
      >
        <Input
          value={data.website}
          onChange={(e) => setData((prev) => ({ ...prev, website: e.target.value }))}
          onBlur={() => saveField("website", data.website)}
          placeholder="https://example.com"
        />
      </FieldWrapper>
      <FieldWrapper
        label={t("settings.company.phone")}
        error={errors.phone}
        saving={savingField === "phone"}
      >
        <Input
          value={data.phone}
          onChange={(e) => setData((prev) => ({ ...prev, phone: e.target.value }))}
          onBlur={() => saveField("phone", data.phone)}
          placeholder="+46 …"
        />
      </FieldWrapper>

      {/* Currency */}
      <FieldWrapper
        label={t("settings.company.currency")}
        error={errors.currency}
        saving={savingField === "currency"}
        hint={t("settings.company.currencyHint")}
      >
        <Select
          value={data.currency}
          onValueChange={(value) => {
            if (!value) return;
            setData((prev) => ({ ...prev, currency: value }));
            saveField("currency", value);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldWrapper>
    </div>
  );
}

function FieldWrapper({
  label,
  required,
  error,
  saving,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  saving?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <div className="relative">
        {children}
        {saving && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

const LOGO_MAX_BYTES = 300_000;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

/** F145: the invoice logo — picked here, printed centred on top of every invoice from the next one issued. */
function LogoField({ initial }: { initial: string | null }) {
  const t = useT();
  const [logo, setLogo] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { executeAsync } = useAction(updateTenantProfileAction);
  const save = async (value: string | null) => {
    setSaving(true);
    setError(null);
    const r = await executeAsync({ logoUrl: value });
    setSaving(false);
    if (r?.serverError || r?.validationErrors || r?.data?.error) {
      setError(t("settings.company.logoFailed"));
      return;
    }
    setLogo(value);
  };
  return (
    <div className="space-y-2" data-testid="company-logo">
      <Label>{t("settings.company.logo")}</Label>
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-48 items-center justify-center rounded-md border border-subtle bg-white p-2">
          {logo ? (
            // biome-ignore lint/performance/noImgElement: a data URL, nothing to optimise
            <img
              src={logo}
              alt={t("settings.company.logo")}
              className="max-h-12 max-w-44 object-contain"
            />
          ) : (
            <span className="text-xs text-muted-foreground">{t("settings.company.noLogo")}</span>
          )}
        </div>
        <label className="cursor-pointer text-sm text-action hover:underline">
          {logo ? t("settings.company.logoReplace") : t("settings.company.logoPick")}
          <input
            type="file"
            accept={LOGO_TYPES.join(",")}
            className="sr-only"
            aria-label={t("settings.company.logoPick")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (!LOGO_TYPES.includes(file.type) || file.size > LOGO_MAX_BYTES) {
                setError(t("settings.company.logoRules"));
                return;
              }
              const reader = new FileReader();
              reader.onload = () => void save(String(reader.result));
              reader.readAsDataURL(file);
            }}
          />
        </label>
        {logo && (
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-destructive"
            onClick={() => void save(null)}
          >
            {t("settings.company.logoRemove")}
          </button>
        )}
        {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-xs text-muted-foreground">{error ?? t("settings.company.logoHint")}</p>
    </div>
  );
}
