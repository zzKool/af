"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCIES } from "@/kernel/nav/constants";
import type { OcrExtractedData } from "@/modules/documents/documents.actions";

type FinancialFieldsSectionProps = {
  resolvedData: Partial<OcrExtractedData>;
  extractedData: OcrExtractedData | null;
  prefixType: string;
  readOnly: boolean;
  onFieldChange: (field: string, value: unknown) => void;
  saveStatus: Record<string, string>;
};

function OcrHint({
  field,
  extractedData,
  resolvedData,
}: {
  field: keyof OcrExtractedData;
  extractedData: OcrExtractedData | null;
  resolvedData: Partial<OcrExtractedData>;
}) {
  const original = extractedData?.[field];
  const current = resolvedData[field];
  if (original == null || original === current) return null;
  return <span className="text-xs text-muted-foreground">OCR: {String(original)}</span>;
}

export function FinancialFieldsSection({
  resolvedData,
  extractedData,
  prefixType,
  readOnly,
  onFieldChange,
  saveStatus,
}: FinancialFieldsSectionProps) {
  const isInvoice = prefixType === "invoice";

  const handleBlur = useCallback(
    (field: string, value: string, type: "text" | "number" = "text") => {
      const parsed = type === "number" ? (value === "" ? undefined : Number(value)) : value;
      onFieldChange(field, parsed);
    },
    [onFieldChange],
  );

  const statusIndicator = (field: string) => {
    const s = saveStatus[field];
    if (s === "saving") return " (saving...)";
    if (s === "error") return " (save failed)";
    return "";
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Financial Details</h3>

      {/* Vendor/Merchant */}
      <div className="space-y-1">
        <Label htmlFor="vendorName">Vendor / Merchant{statusIndicator("vendorName")}</Label>
        <Input
          id="vendorName"
          defaultValue={String(resolvedData.vendorName ?? resolvedData.merchantName ?? "")}
          disabled={readOnly}
          onBlur={(e) => handleBlur("vendorName", e.target.value)}
        />
        <OcrHint field="vendorName" extractedData={extractedData} resolvedData={resolvedData} />
      </div>

      {/* Date */}
      <div className="space-y-1">
        <Label htmlFor="invoiceDate">
          {isInvoice ? "Invoice Date" : "Transaction Date"}
          {statusIndicator("invoiceDate")}
        </Label>
        <Input
          id="invoiceDate"
          type="date"
          defaultValue={String(resolvedData.invoiceDate ?? resolvedData.transactionDate ?? "")}
          disabled={readOnly}
          onChange={(e) =>
            onFieldChange(isInvoice ? "invoiceDate" : "transactionDate", e.target.value)
          }
        />
      </div>

      {/* Due date (invoice only) */}
      {isInvoice && (
        <div className="space-y-1">
          <Label htmlFor="dueDate">Due Date{statusIndicator("dueDate")}</Label>
          <Input
            id="dueDate"
            type="date"
            defaultValue={String(resolvedData.dueDate ?? "")}
            disabled={readOnly}
            onChange={(e) => onFieldChange("dueDate", e.target.value)}
          />
        </div>
      )}

      {/* Invoice number */}
      {isInvoice && (
        <div className="space-y-1">
          <Label htmlFor="invoiceNumber">Invoice #{statusIndicator("invoiceNumber")}</Label>
          <Input
            id="invoiceNumber"
            defaultValue={String(resolvedData.invoiceNumber ?? "")}
            disabled={readOnly}
            onBlur={(e) => handleBlur("invoiceNumber", e.target.value)}
          />
          <OcrHint
            field="invoiceNumber"
            extractedData={extractedData}
            resolvedData={resolvedData}
          />
        </div>
      )}

      {/* Amount */}
      <div className="space-y-1">
        <Label htmlFor="invoiceTotal">
          {isInvoice ? "Invoice Total" : "Amount"}
          {statusIndicator("invoiceTotal")}
        </Label>
        <Input
          id="invoiceTotal"
          type="number"
          step="0.01"
          defaultValue={resolvedData.invoiceTotal != null ? String(resolvedData.invoiceTotal) : ""}
          disabled={readOnly}
          onBlur={(e) => handleBlur("invoiceTotal", e.target.value, "number")}
        />
        <OcrHint field="invoiceTotal" extractedData={extractedData} resolvedData={resolvedData} />
      </div>

      {/* Subtotal */}
      <div className="space-y-1">
        <Label htmlFor="subtotal">Subtotal{statusIndicator("subtotal")}</Label>
        <Input
          id="subtotal"
          type="number"
          step="0.01"
          defaultValue={resolvedData.subtotal != null ? String(resolvedData.subtotal) : ""}
          disabled={readOnly}
          onBlur={(e) => handleBlur("subtotal", e.target.value, "number")}
        />
      </div>

      {/* VAT */}
      <div className="space-y-1">
        <Label htmlFor="totalTax">VAT / Tax{statusIndicator("totalTax")}</Label>
        <Input
          id="totalTax"
          type="number"
          step="0.01"
          defaultValue={resolvedData.totalTax != null ? String(resolvedData.totalTax) : ""}
          disabled={readOnly}
          onBlur={(e) => handleBlur("totalTax", e.target.value, "number")}
        />
        <OcrHint field="totalTax" extractedData={extractedData} resolvedData={resolvedData} />
      </div>

      {/* Currency */}
      <div className="space-y-1">
        <Label htmlFor="currency">Currency{statusIndicator("currency")}</Label>
        <Select
          defaultValue={resolvedData.currency ?? ""}
          disabled={readOnly}
          onValueChange={(value) => onFieldChange("currency", value)}
        >
          <SelectTrigger id="currency">
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
    </div>
  );
}
