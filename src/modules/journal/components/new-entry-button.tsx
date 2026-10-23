"use client";

// The page's one primary (D40): *New entry* in the title row, opening the manual-entry dialog. Owner only — the page
// renders it when `can(create, journal_entry)`.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import type { CategoryOption, PartnerOption } from "./categorise-form";
import { ManualEntryDialog } from "./manual-entry-dialog";

export function NewEntryButton({
  today,
  categories,
  partners,
}: {
  today: string;
  categories: CategoryOption[];
  partners: PartnerOption[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="new-entry">
        {t("journal.new")}
      </Button>
      <ManualEntryDialog
        open={open}
        onOpenChange={setOpen}
        today={today}
        categories={categories}
        partners={partners}
      />
    </>
  );
}
