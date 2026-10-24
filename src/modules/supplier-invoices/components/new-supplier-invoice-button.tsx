"use client";

// The page's one primary (D40 title row): *New supplier invoice* and the dialog it opens. The sidebar's **+ New**
// lands on this page with `?new=1`, which opens the dialog (F73). Rendered only for a caller who may create.
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { useNewParam } from "@/kernel/ui/shell/use-new-param";
import type {
  CategoryOption,
  DocumentOption,
  GroupOption,
  RegistrationOption,
  SupplierOption,
} from "@/modules/supplier-invoices/types";
import { NewSupplierInvoiceDialog } from "./new-supplier-invoice-dialog";

export function NewSupplierInvoiceButton({
  groups,
  categories,
  suppliers,
  registrations,
  documents,
  defaultGroupId,
}: {
  groups: GroupOption[];
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  registrations: RegistrationOption[];
  documents: DocumentOption[];
  defaultGroupId?: string;
}) {
  const t = useT();
  const [open, setOpen] = useNewParam();
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="open-new-supplier-invoice">
        {t("supplierInvoices.new")}
      </Button>
      <NewSupplierInvoiceDialog
        open={open}
        onOpenChange={setOpen}
        groups={groups}
        categories={categories}
        suppliers={suppliers}
        registrations={registrations}
        documents={documents}
        defaultGroupId={defaultGroupId}
      />
    </>
  );
}
