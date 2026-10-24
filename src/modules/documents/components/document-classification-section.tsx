"use client";

import { useRouter } from "next/navigation";
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
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
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
  const t = useT();
  const router = useRouter();
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
      // the type drives the reading (D52): the key follows it and the new kind's model reads the document again
      const done = result?.data?.data;
      if (done?.reread) {
        toast.success(
          t("documents.review.rereading", {
            type: t(`documents.prefix.${newPrefixType}` as MessageKey),
          }),
        );
      }
      router.refresh();
    },
    [documentId, onClassificationChange, router, t],
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
      <h2 className="text-sm font-medium">{t("documents.review.classification")}</h2>

      <div className="space-y-1">
        <Label htmlFor="category">{t("documents.review.category")}</Label>
        <Select value={category} onValueChange={handleCategoryChange}>
          <SelectTrigger id="category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="financial">{t("documents.category.financial")}</SelectItem>
            <SelectItem value="relationship">{t("documents.category.relationship")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="prefixType">{t("documents.review.type")}</Label>
        <Select value={prefixType} onValueChange={handlePrefixChange}>
          <SelectTrigger id="prefixType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES[category].map((type) => (
              <SelectItem key={type} value={type}>
                {t(`documents.prefix.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
