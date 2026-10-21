"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/kernel/i18n/use-t";

type PaymentDetailsSectionProps = {
  paymentDetails?: { iban?: string; swift?: string; bankName?: string }[];
};

export function PaymentDetailsSection({ paymentDetails }: PaymentDetailsSectionProps) {
  const t = useT();
  if (!paymentDetails || paymentDetails.length === 0) return null;

  const detail = paymentDetails[0];

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">{t("documents.review.payment")}</h2>
      {detail.iban && (
        <div className="space-y-1">
          <Label htmlFor="iban">IBAN</Label>
          <Input id="iban" value={detail.iban} disabled className="font-mono" />
        </div>
      )}
      {detail.swift && (
        <div className="space-y-1">
          <Label htmlFor="swift">SWIFT</Label>
          <Input id="swift" value={detail.swift} disabled className="font-mono" />
        </div>
      )}
      {detail.bankName && (
        <div className="space-y-1">
          <Label htmlFor="bankName">{t("documents.review.bank")}</Label>
          <Input id="bankName" value={detail.bankName} disabled />
        </div>
      )}
    </div>
  );
}
