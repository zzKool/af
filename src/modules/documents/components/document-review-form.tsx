"use client";

import type { CompanyIdentity } from "@/modules/documents/billed-to";
import { AlsoReadSection } from "@/modules/documents/components/also-read-section";
import { DocumentClassificationSection } from "@/modules/documents/components/document-classification-section";
import { FinancialFieldsSection } from "@/modules/documents/components/financial-fields-section";
import { LineItemsSection } from "@/modules/documents/components/line-items-section";
import { PaymentDetailsSection } from "@/modules/documents/components/payment-details-section";
import { RelationshipFieldsSection } from "@/modules/documents/components/relationship-fields-section";
import type {
  DocumentReviewData,
  OcrExtractedData,
  OcrLineItem,
} from "@/modules/documents/documents.actions";

type DocumentReviewFormProps = {
  data: DocumentReviewData;
  resolvedData: Partial<OcrExtractedData>;
  prefixType: string;
  readOnly: boolean;
  saveStatus: Record<string, string>;
  onFieldChange: (field: string, value: unknown) => void;
  onItemsChange: (items: OcrLineItem[]) => void;
  onClassificationChange: (newPrefixType: string) => void;
  company?: CompanyIdentity | null;
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
  company = null,
}: DocumentReviewFormProps) {
  const isFinancial =
    prefixType === "expense" || prefixType === "invoice" || prefixType === "document";

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
            company={company}
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

      {/* F127: every field DI returned that the form does not show — read-only; nothing on a reading without `fields` */}
      <AlsoReadSection
        fields={data.extractedData?.fields}
        modelUsed={data.extractedData?.modelUsed}
      />
    </div>
  );
}
