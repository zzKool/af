"use client";

// A contract's inline form, expanded below its row in the Contracts tab (`contract-list.tsx`): every field saves on
// blur or on change through the list's `onAutoSave`, the external references save as a list, and the contract's
// Rates section (D24) sits below. Split out of the list (F67, lessons *Components over 400 lines*) — same DOM.
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
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
import { formatMoney } from "@/kernel/money/format-money";
import { CURRENCIES, PAYMENT_TERMS } from "@/kernel/nav/constants";
import { DetailsSection } from "@/kernel/ui/details-section";
import type { CurrentRate } from "@/modules/contracts/types";
import { type ContractRateRow, ContractRates } from "./contract-rates";

export type ExternalReference = { label: string; value: string };

export type VatOption = { id: string; label: string };
export type EmployeeOption = { id: string; name: string };

export type ContractRow = {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  assignedEmployeeId: string | null;
  /** Derived on the server from the rate history (D24) — refreshed here after every rate change. */
  currentRate: CurrentRate | null;
  rates: ContractRateRow[];
  currency: string | null;
  paymentTerms: string | null;
  vatRegistrationId: string | null;
  externalReferences: ExternalReference[];
  isActive: boolean;
};

export function ContractEditForm({
  contract,
  vatRegistrations,
  employeePartners,
  onAutoSave,
  onRatesChange,
}: {
  contract: ContractRow;
  vatRegistrations: VatOption[];
  employeePartners: EmployeeOption[];
  onAutoSave: (id: string, field: string, value: unknown) => Promise<boolean>;
  onRatesChange: (contractId: string, rates: ContractRateRow[]) => void;
}) {
  const t = useT();
  const [name, setName] = useState(contract.name);
  const [startDate, setStartDate] = useState(contract.startDate);
  const [endDate, setEndDate] = useState(contract.endDate ?? "");
  const [currency, setCurrency] = useState(contract.currency ?? "");
  const [paymentTerms, setPaymentTerms] = useState(contract.paymentTerms ?? "");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(contract.assignedEmployeeId ?? "");
  const [vatRegistrationId, setVatRegistrationId] = useState(contract.vatRegistrationId ?? "");
  const [externalRefs, setExternalRefs] = useState<ExternalReference[]>(
    contract.externalReferences ?? [],
  );

  const handleBlur = useCallback(
    (field: string, currentValue: string, originalValue: string | null) => {
      if (currentValue === (originalValue ?? "")) return;
      // Empty string → undefined for optional fields so Zod's .optional() accepts the clear
      onAutoSave(contract.id, field, currentValue || undefined);
    },
    [contract.id, onAutoSave],
  );

  const handleSelectChange = useCallback(
    (field: string, value: string | null, setter: (v: string) => void) => {
      const cleared = !value || value === "__none__" ? "" : value;
      setter(cleared);
      onAutoSave(contract.id, field, cleared || undefined);
    },
    [contract.id, onAutoSave],
  );

  const handleRefsSave = useCallback(() => {
    const valid = externalRefs.filter((r) => r.label.trim() && r.value.trim());
    setExternalRefs(valid);
    onAutoSave(contract.id, "externalReferences", valid);
  }, [externalRefs, contract.id, onAutoSave]);

  return (
    <div className="space-y-4 border-l-2 border-subtle bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>{t("contracts.form.name")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => handleBlur("name", name, contract.name)}
          />
        </div>
        <div>
          <Label>{t("contracts.form.startDate")}</Label>
          <DateInput
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            onBlur={() => handleBlur("startDate", startDate, contract.startDate)}
          />
        </div>
        <div>
          <Label>{t("contracts.form.endDate")}</Label>
          <DateInput
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            onBlur={() => handleBlur("endDate", endDate, contract.endDate)}
          />
        </div>
        <div>
          <Label>{t("contracts.currentRate")}</Label>
          <p
            className="flex h-9 items-center text-sm tabular-nums"
            data-testid="current-rate"
            data-amount={contract.currentRate?.rate}
          >
            {contract.currentRate
              ? `${formatMoney(contract.currentRate.rate, contract.currency)} / ${t(`contracts.rates.unit.${contract.currentRate.unit}`)}`
              : t("contracts.currentRate.none")}
          </p>
        </div>
        <div>
          <Label>{t("contracts.form.currency")}</Label>
          <Select
            value={currency || "__none__"}
            onValueChange={(v) => handleSelectChange("currency", v, setCurrency)}
            disabled={contract.rates.length > 0 && !!contract.currency}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("contracts.form.selectCurrency")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("contracts.form.none")}</SelectItem>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {contract.rates.length > 0 && !!contract.currency && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("contracts.currency.lockedHint")}
            </p>
          )}
        </div>
        <div>
          <Label>{t("contracts.form.paymentTerms")}</Label>
          <Select
            value={paymentTerms || "__none__"}
            onValueChange={(v) => handleSelectChange("paymentTerms", v, setPaymentTerms)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("contracts.form.selectPaymentTerms")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("contracts.form.none")}</SelectItem>
              {PAYMENT_TERMS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("contracts.form.employee")}</Label>
          <Select
            value={assignedEmployeeId || "__none__"}
            onValueChange={(v) =>
              handleSelectChange("assignedEmployeeId", v, setAssignedEmployeeId)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("contracts.form.selectEmployee")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("contracts.form.none")}</SelectItem>
              {employeePartners.length === 0 ? (
                <SelectItem value="__empty__" disabled>
                  No employees added yet
                </SelectItem>
              ) : (
                employeePartners.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("contracts.form.vatRegistration")}</Label>
          <Select
            value={vatRegistrationId || "__none__"}
            onValueChange={(v) => handleSelectChange("vatRegistrationId", v, setVatRegistrationId)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("contracts.form.selectVatRegistration")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("contracts.form.none")}</SelectItem>
              {vatRegistrations.length === 0 ? (
                <SelectItem value="__empty__" disabled>
                  No VAT registrations configured
                </SelectItem>
              ) : (
                vatRegistrations.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* External References */}
      <DetailsSection title={t("contracts.form.references")}>
        <div className="mb-2 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (externalRefs.length >= 5) {
                toast.error(t("contracts.form.referencesMax"));
                return;
              }
              setExternalRefs([...externalRefs, { label: "", value: "" }]);
            }}
          >
            {t("contracts.form.addReference")}
          </Button>
        </div>
        {externalRefs.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("contracts.form.noReferences")}</p>
        )}
        {externalRefs.map((ref, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: dynamic list without stable IDs
          <div key={i} className="mb-2 flex items-end gap-2">
            <div className="flex-1">
              <Input
                value={ref.label}
                onChange={(e) => {
                  const updated = [...externalRefs];
                  updated[i] = { ...updated[i], label: e.target.value };
                  setExternalRefs(updated);
                }}
                placeholder={t("partners.form.identifierLabel")}
              />
            </div>
            <div className="flex-1">
              <Input
                value={ref.value}
                onChange={(e) => {
                  const updated = [...externalRefs];
                  updated[i] = { ...updated[i], value: e.target.value };
                  setExternalRefs(updated);
                }}
                placeholder={t("partners.form.identifierValue")}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const updated = externalRefs.filter((_, idx) => idx !== i);
                setExternalRefs(updated);
                onAutoSave(contract.id, "externalReferences", updated);
              }}
            >
              {t("partners.form.remove")}
            </Button>
          </div>
        ))}
        {externalRefs.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleRefsSave}>
            {t("contracts.form.saveReferences")}
          </Button>
        )}
      </DetailsSection>

      {/* Rates (D24) */}
      <ContractRates
        contractId={contract.id}
        currency={contract.currency}
        rates={contract.rates}
        onRatesChange={onRatesChange}
      />
    </div>
  );
}
