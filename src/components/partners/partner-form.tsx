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
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { CURRENCIES, SUPPORTED_LOCALES } from "@/lib/constants";
import {
  deactivatePartnerAction,
  reactivatePartnerAction,
  updatePartnerAction,
} from "@/server/actions/partners";

type BasOption = { code: string; label: string };

type ExternalIdentifier = { label: string; value: string };

type PartnerData = {
  id: string;
  name: string;
  orgNumber: string | null;
  vatNumber: string | null;
  types: string[];
  defaultCurrency: string | null;
  defaultLanguage: string | null;
  defaultBasCategoryCode: string | null;
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
}

function extractError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.serverError && typeof r.serverError === "object") {
    return (r.serverError as { message?: string }).message ?? "An error occurred";
  }
  if (r.data && typeof r.data === "object" && (r.data as Record<string, unknown>).error) {
    const err = (r.data as Record<string, unknown>).error as { message?: string };
    return err.message ?? "An error occurred";
  }
  return null;
}

export function PartnerForm({ partner, basOptions }: PartnerFormProps) {
  const [name, setName] = useState(partner.name);
  const [orgNumber, setOrgNumber] = useState(partner.orgNumber ?? "");
  const [vatNumber, setVatNumber] = useState(partner.vatNumber ?? "");
  const [types, setTypes] = useState<string[]>(partner.types);
  const [defaultCurrency, setDefaultCurrency] = useState(partner.defaultCurrency ?? "");
  const [defaultLanguage, setDefaultLanguage] = useState(partner.defaultLanguage ?? "");
  const [defaultBasCategoryCode, setDefaultBasCategoryCode] = useState(
    partner.defaultBasCategoryCode ?? "",
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

  const { dialogProps, confirm } = useConfirmDialog({
    title: "Deactivate Partner",
    variant: "destructive",
    confirmLabel: "Deactivate",
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

  // onBlur handlers for text fields
  const handleBlur = useCallback(
    (field: string, currentValue: string, originalValue: string | null) => {
      if (currentValue === (originalValue ?? "")) return;
      autoSave(field, currentValue || undefined);
    },
    [autoSave],
  );

  // onChange handlers for selects
  const handleSelectChange = useCallback(
    (field: string, value: string) => {
      autoSave(field, value || undefined);
    },
    [autoSave],
  );

  // Types toggle
  const handleTypeToggle = useCallback(
    (type: string, checked: boolean) => {
      const newTypes = checked ? [...types, type] : types.filter((t) => t !== type);
      if (newTypes.length === 0) {
        toast.error("At least one type required");
        return;
      }
      setTypes(newTypes);
      autoSave("types", newTypes);
    },
    [types, autoSave],
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
      toast.error("Maximum 5 external identifiers");
      return;
    }
    setExternalIdentifiers([...externalIdentifiers, { label: "", value: "" }]);
  }, [externalIdentifiers]);

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
        toast.success("Partner deactivated");
      },
      {
        description: `Deactivate "${name}"? The partner will be hidden from active lists but retained for historical references.`,
      },
    );
  }, [confirm, execDeactivate, partner.id, name]);

  const handleReactivate = useCallback(async () => {
    const result = await execReactivate({ id: partner.id });
    const error = extractError(result);
    if (error) {
      toast.error(error);
      return;
    }
    setIsActive(true);
    toast.success("Partner reactivated");
  }, [execReactivate, partner.id]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/partners" className="text-muted-foreground hover:text-foreground">
            &larr; Partners
          </Link>
          <h1 className="text-2xl font-semibold">{name}</h1>
          <Badge variant={isActive ? "default" : "secondary"}>
            {isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
        {isActive ? (
          <Button variant="destructive" size="sm" onClick={handleDeactivate}>
            Deactivate
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={handleReactivate}>
            Reactivate
          </Button>
        )}
      </div>

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => handleBlur("name", name, partner.name)}
            />
          </div>
          <div>
            <Label>Types</Label>
            <div className="flex gap-3 pt-2">
              {["client", "vendor", "employee"].map((type) => (
                <label key={type} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={types.includes(type)}
                    onChange={(e) => handleTypeToggle(type, e.target.checked)}
                  />
                  {type}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="orgNumber">Org Number</Label>
            <Input
              id="orgNumber"
              value={orgNumber}
              onChange={(e) => setOrgNumber(e.target.value)}
              onBlur={() => handleBlur("orgNumber", orgNumber, partner.orgNumber)}
            />
          </div>
          <div>
            <Label htmlFor="vatNumber">VAT Number</Label>
            <Input
              id="vatNumber"
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              onBlur={() => handleBlur("vatNumber", vatNumber, partner.vatNumber)}
            />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => handleBlur("email", email, partner.email)}
            />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
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
          <CardTitle>Defaults</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>Currency</Label>
            <Select
              value={defaultCurrency}
              onValueChange={(v) => {
                setDefaultCurrency(v ?? "");
                handleSelectChange("defaultCurrency", v ?? "");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select currency" />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Language</Label>
            <Select
              value={defaultLanguage}
              onValueChange={(v) => {
                setDefaultLanguage(v ?? "");
                handleSelectChange("defaultLanguage", v ?? "");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LOCALES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>BAS Category</Label>
            <Select
              value={defaultBasCategoryCode}
              onValueChange={(v) => {
                setDefaultBasCategoryCode(v ?? "");
                handleSelectChange("defaultBasCategoryCode", v ?? "");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select BAS category" />
              </SelectTrigger>
              <SelectContent>
                {basOptions.map((o) => (
                  <SelectItem key={o.code} value={o.code}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Address */}
      <Card>
        <CardHeader>
          <CardTitle>Address</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="street">Street</Label>
              <Input
                id="street"
                value={address.street ?? ""}
                onChange={(e) => setAddress({ ...address, street: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={address.city ?? ""}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="postalCode">Postal Code</Label>
              <Input
                id="postalCode"
                value={address.postalCode ?? ""}
                onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="country">Country (2-letter code)</Label>
              <Input
                id="country"
                value={address.country ?? ""}
                onChange={(e) => setAddress({ ...address, country: e.target.value })}
                maxLength={2}
              />
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleAddressSave}>
            Save Address
          </Button>
        </CardContent>
      </Card>

      {/* External Identifiers */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>External Identifiers</CardTitle>
            <Button variant="outline" size="sm" onClick={addExternalIdentifier}>
              Add Identifier
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {externalIdentifiers.length === 0 && (
            <p className="text-sm text-muted-foreground">No external identifiers.</p>
          )}
          {externalIdentifiers.map((ei, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: dynamic list without stable IDs
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Label>Label</Label>
                <Input
                  value={ei.label}
                  onChange={(e) => {
                    const updated = [...externalIdentifiers];
                    updated[i] = { ...updated[i], label: e.target.value };
                    setExternalIdentifiers(updated);
                  }}
                  placeholder="e.g., Supplier Number"
                />
              </div>
              <div className="flex-1">
                <Label>Value</Label>
                <Input
                  value={ei.value}
                  onChange={(e) => {
                    const updated = [...externalIdentifiers];
                    updated[i] = { ...updated[i], value: e.target.value };
                    setExternalIdentifiers(updated);
                  }}
                  placeholder="e.g., SUP-44821"
                />
              </div>
              <Button variant="ghost" size="sm" onClick={() => removeExternalIdentifier(i)}>
                Remove
              </Button>
            </div>
          ))}
          {externalIdentifiers.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleExternalIdsSave}>
              Save Identifiers
            </Button>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
