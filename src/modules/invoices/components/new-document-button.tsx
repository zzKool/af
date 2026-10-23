"use client";

// The list's one primary (D40 title row): New invoice, with New quote behind ▾. A credit note is never new on
// its own — it is made from its invoice (that page's primary).
import { useRouter } from "next/navigation";
import { useT } from "@/kernel/i18n/use-t";
import { SplitButton } from "@/kernel/ui/split-button";

export function NewDocumentButton() {
  const t = useT();
  const router = useRouter();
  return (
    <SplitButton
      onClick={() => router.push("/invoices/new?type=invoice")}
      items={[
        { label: t("invoices.new.quote"), onClick: () => router.push("/invoices/new?type=quote") },
      ]}
      menuLabel={t("invoices.new")}
    >
      {t("invoices.new.invoice")}
    </SplitButton>
  );
}
