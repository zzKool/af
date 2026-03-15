"use client";

import { DocumentClassificationSection } from "@/components/domain/document-classification-section";
import { FinancialFieldsSection } from "@/components/domain/financial-fields-section";
import { LineItemsSection } from "@/components/domain/line-items-section";
import { PaymentDetailsSection } from "@/components/domain/payment-details-section";
import { RelationshipFieldsSection } from "@/components/domain/relationship-fields-section";
import type { DocumentReviewData } from "@/server/services/documents";
import type { OcrExtractedData, OcrLineItem } from "@/server/services/ocr";

type DocumentReviewFormProps = {
  data: DocumentReviewData;
  resolvedData: Partial<OcrExtractedData>;
  prefixType: string;
  readOnly: boolean;
  saveStatus: Record<string, string>;
  onFieldChange: (field: string, value: unknown) => void;
  onItemsChange: (items: OcrLineItem[]) => void;
  onClassificationChange: (newPrefixType: string) => void;
};

export function DocumentReviewForm({
  data,
  resolvedData,
  prefixType,
  readOnly,
  saveStatus,
  onFieldChange,
  onItemsChange,
  onClassificationChange,
}: DocumentReviewFormProps) {
  const isFinancial = prefixType === "expense" || prefixType === "invoice";

  return (
    <div className="space-y-6">
      <DocumentClassificationSection
        documentId={data.id}
        prefixType={prefixType}
        readOnly={readOnly}
        onClassificationChange={onClassificationChange}
      />

      {isFinancial ? (
        <>
          <FinancialFieldsSection
            resolvedData={resolvedData}
            extractedData={data.extractedData}
            prefixType={prefixType}
            readOnly={readOnly}
            onFieldChange={onFieldChange}
            saveStatus={saveStatus}
          />

          <LineItemsSection
            items={(resolvedData.items as OcrLineItem[]) ?? []}
            invoiceTotal={resolvedData.invoiceTotal as number | undefined}
            readOnly={readOnly}
            onItemsChange={onItemsChange}
          />

          <PaymentDetailsSection paymentDetails={resolvedData.paymentDetails} />
        </>
      ) : (
        <RelationshipFieldsSection rawText={resolvedData.rawText} />
      )}
    </div>
  );
}
