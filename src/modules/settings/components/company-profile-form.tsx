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
import { CompanyAvatar } from "@/kernel/ui/company-avatar";
import { updateTenantProfileAction } from "@/modules/settings/settings.actions";

type ProfileData = {
  name: string;
  orgNumber: string;
  address: string;
  currency: string;
};

const CURRENCIES = ["SEK", "CHF", "EUR", "USD"] as const;

export function CompanyProfileForm({ initialData }: { initialData: ProfileData }) {
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
        setErrors((prev) => ({ ...prev, name: "Company name is required" }));
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
          result?.serverError?.message ?? result?.data?.error?.message ?? "Save failed";
        setErrors((prev) => ({ ...prev, [field]: errorMsg }));
        setData((prev) => ({ ...prev, [field]: previousData.current[field] }));
      } else {
        previousData.current = { ...previousData.current, [field]: value };
      }

      setSavingField(null);
    },
    [executeAsync],
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

      {/* Company Name */}
      <FieldWrapper
        label="Company Name"
        required
        error={errors.name}
        saving={savingField === "name"}
      >
        <Input
          value={data.name}
          onChange={(e) => setData((prev) => ({ ...prev, name: e.target.value }))}
          onBlur={() => saveField("name", data.name)}
          placeholder="Enter company name"
        />
      </FieldWrapper>

      {/* Org Number */}
      <FieldWrapper
        label="Organization Number"
        error={errors.orgNumber}
        saving={savingField === "orgNumber"}
      >
        <Input
          value={data.orgNumber}
          onChange={(e) => setData((prev) => ({ ...prev, orgNumber: e.target.value }))}
          onBlur={() => saveField("orgNumber", data.orgNumber)}
          placeholder="e.g., 556677-8899"
        />
      </FieldWrapper>

      {/* Address */}
      <FieldWrapper
        label="Registered Address"
        error={errors.address}
        saving={savingField === "address"}
      >
        <Input
          value={data.address}
          onChange={(e) => setData((prev) => ({ ...prev, address: e.target.value }))}
          onBlur={() => saveField("address", data.address)}
          placeholder="e.g., Testgatan 1, 111 22 Stockholm"
        />
      </FieldWrapper>

      {/* Currency */}
      <FieldWrapper
        label="Base Currency"
        error={errors.currency}
        saving={savingField === "currency"}
        hint="Base currency for all financial calculations"
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
