"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { classifyDocumentAction } from "@/modules/documents/documents.actions";

const CATEGORIES = {
  financial: ["expense", "invoice"],
  relationship: ["contract", "nda", "certificate"],
} as const;

type DocumentClassificationSectionProps = {
  documentId: string;
  prefixType: string;
  readOnly: boolean;
  onClassificationChange: (newPrefixType: string) => void;
};

export function DocumentClassificationSection({
  documentId,
  prefixType,
  readOnly,
  onClassificationChange,
}: DocumentClassificationSectionProps) {
  const isFinancial = prefixType === "expense" || prefixType === "invoice";
  const category = isFinancial ? "financial" : "relationship";

  const handlePrefixChange = useCallback(
    async (newPrefixType: string | null) => {
      if (!newPrefixType) return;
      const result = await classifyDocumentAction({
        documentId,
        documentType: newPrefixType as "expense" | "invoice" | "contract" | "nda" | "certificate",
      });
      const error = extractError(result);
      if (error) {
        toast.error(error);
        return;
      }
      onClassificationChange(newPrefixType);
    },
    [documentId, onClassificationChange],
  );

  const handleCategoryChange = useCallback(
    (newCategory: string | null) => {
      if (!newCategory) return;
      const defaultType = newCategory === "financial" ? "expense" : "contract";
      handlePrefixChange(defaultType);
    },
    [handlePrefixChange],
  );

  if (readOnly) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Classification</h3>

      <div className="space-y-1">
        <Label htmlFor="category">Category</Label>
        <Select value={category} onValueChange={handleCategoryChange}>
          <SelectTrigger id="category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="financial">Financial</SelectItem>
            <SelectItem value="relationship">Relationship</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="prefixType">Type</Label>
        <Select value={prefixType} onValueChange={handlePrefixChange}>
          <SelectTrigger id="prefixType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES[category].map((t) => (
              <SelectItem key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
