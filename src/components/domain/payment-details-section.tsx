"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PaymentDetailsSectionProps = {
  paymentDetails?: { iban?: string; swift?: string; bankName?: string }[];
};

export function PaymentDetailsSection({ paymentDetails }: PaymentDetailsSectionProps) {
  if (!paymentDetails || paymentDetails.length === 0) return null;

  const detail = paymentDetails[0];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Payment Details</h3>
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
          <Label htmlFor="bankName">Bank</Label>
          <Input id="bankName" value={detail.bankName} disabled />
        </div>
      )}
    </div>
  );
}
