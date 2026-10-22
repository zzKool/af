"use client";

// The facts of the supplier-invoice panel — category, VAT registration, note (saved on change / blur),
// *document missing*, the cancel reason once cancelled — then its lines and its document.
import Link from "next/link";
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/kernel/i18n/use-t";
import type { CategoryOption, RegistrationOption } from "@/modules/supplier-invoices/types";
import {
  money,
  NONE,
  type SaveSupplierInvoice,
  type SupplierInvoicePanelDetail,
} from "./supplier-invoice-panel-shared";

export function SupplierInvoiceFactsSection({
  detail,
  categories,
  registrations,
  canWrite,
  save,
  saving,
}: {
  detail: SupplierInvoicePanelDetail;
  categories: CategoryOption[];
  registrations: RegistrationOption[];
  canWrite: boolean;
  save: SaveSupplierInvoice;
  saving: boolean;
}) {
  const t = useT();
  const ids = useId();
  const si = detail.invoice;

  // the note is put back to the saved value on every reload of the panel
  const [note, setNote] = useState(si.note ?? "");
  const [loaded, setLoaded] = useState(detail);
  if (loaded !== detail) {
    setLoaded(detail);
    setNote(si.note ?? "");
  }

  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{t("supplierInvoices.panel.facts")}</h3>
      {canWrite && !si.cancelled ? (
        <div className="grid gap-3" data-testid="facts-form">
          <div>
            <label htmlFor={`${ids}-cat`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.category")}
            </label>
            <Select
              value={si.basCode}
              onValueChange={(v) => v && v !== si.basCode && void save({ basCode: v })}
              disabled={saving}
            >
              <SelectTrigger id={`${ids}-cat`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(categories.some((c) => c.code === si.basCode)
                  ? categories
                  : [{ code: si.basCode, label: detail.basLabel }, ...categories]
                ).map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{t("expenses.form.aliasWarning")}</p>
          </div>
          <div>
            <label htmlFor={`${ids}-reg`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.registration")}
            </label>
            <Select
              value={si.vatRegistrationId ?? NONE}
              onValueChange={(v) => {
                const next = !v || v === NONE ? null : v;
                if (next !== si.vatRegistrationId) void save({ vatRegistrationId: next });
              }}
              disabled={saving}
            >
              <SelectTrigger id={`${ids}-reg`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("supplierInvoices.form.noRegistration")}</SelectItem>
                {registrations.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor={`${ids}-note`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.note")}
            </label>
            <Input
              id={`${ids}-note`}
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              onBlur={() => {
                if ((note.trim() || null) !== (si.note ?? null))
                  void save({ note: note.trim() || null });
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${ids}-missing`}
              checked={si.documentMissing}
              onCheckedChange={(c) => void save({ documentMissing: c === true })}
              disabled={saving}
              aria-label={t("supplierInvoices.form.documentMissing")}
            />
            <span>{t("supplierInvoices.form.documentMissing")}</span>
          </label>
        </div>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t("supplierInvoices.form.registration")}</dt>
          <dd>{detail.vatRegistrationLabel ?? "—"}</dd>
          <dt className="text-muted-foreground">{t("supplierInvoices.form.note")}</dt>
          <dd>{si.note ?? "—"}</dd>
          {si.cancelled && (
            <>
              <dt className="text-muted-foreground">
                {t("supplierInvoices.panel.cancelledReason")}
              </dt>
              <dd>{si.cancelledReason ?? "—"}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}

export function SupplierInvoiceLinesSection({ detail }: { detail: SupplierInvoicePanelDetail }) {
  const t = useT();
  const si = detail.invoice;
  if (si.lines.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{t("supplierInvoices.panel.lines")}</h3>
      <ul className="divide-y rounded-md border text-sm">
        {si.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="truncate">
              {l.lineNo}. {l.description}{" "}
              <span className="text-xs text-muted-foreground">
                · {l.basCode} · {l.vatRate}%
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              {money(l.amountNet, si.currency)} + {money(l.vatAmount, si.currency)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SupplierInvoiceDocumentSection({ detail }: { detail: SupplierInvoicePanelDetail }) {
  const t = useT();
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{t("supplierInvoices.panel.document")}</h3>
      {detail.document ? (
        <p className="text-sm">
          <Link
            href={`/documents/${detail.document.id}`}
            className="font-mono text-xs hover:underline"
          >
            {detail.document.fileName}
          </Link>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {detail.invoice.documentMissing
            ? t("supplierInvoices.form.documentMissing")
            : t("supplierInvoices.form.noDocument")}
        </p>
      )}
    </section>
  );
}
