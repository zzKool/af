"use client";

// The Contacts tab of the partner page (F08, specs/partners/spec.md): inline add, a row is read (mailto / tel
// links) or edited as one thing (Save / Cancel), delete with confirm. No route of its own.
import { useAction } from "next-safe-action/hooks";
import { useCallback, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AppError } from "@/kernel/errors/app-error";
import { useT } from "@/kernel/i18n/use-t";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  createPartnerContactAction,
  deletePartnerContactAction,
  listPartnerContactsAction,
  updatePartnerContactAction,
} from "@/modules/partners/partners.actions";

/** What the page hands over: plain strings, the server's order (by name). */
export type PartnerContactRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
};

type Draft = { name: string; role: string; email: string; phone: string };
type Field = keyof Draft;
type ActionResult = { serverError?: { message?: string }; data?: { error?: AppError } } | undefined;

const EMPTY: Draft = { name: "", role: "", email: "", phone: "" };
const MAX: Record<Field, number> = { name: 200, role: 100, email: 254, phone: 50 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toDraft(row: PartnerContactRow): Draft {
  return { name: row.name, role: row.role ?? "", email: row.email ?? "", phone: row.phone ?? "" };
}

export function PartnerContacts({
  partnerId,
  contacts: initialContacts,
  onCountChange,
}: {
  partnerId: string;
  contacts: PartnerContactRow[];
  /** Called with the fresh count after every change — the tab label and the overview follow. */
  onCountChange?: (count: number) => void;
}) {
  const t = useT();
  const [contacts, setContacts] = useState<PartnerContactRow[]>(initialContacts);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { executeAsync: execList } = useAction(listPartnerContactsAction);
  const { executeAsync: execCreate, isPending: isCreating } = useAction(createPartnerContactAction);
  const { executeAsync: execUpdate, isPending: isUpdating } = useAction(updatePartnerContactAction);
  const { executeAsync: execDelete } = useAction(deletePartnerContactAction);
  const { dialogProps, confirm } = useConfirmDialog({
    title: t("partners.contacts.deleteConfirm.title"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });

  /** Checked here first so the message is in the user's language; the server checks again. */
  const draftError = useCallback(
    (d: Draft): string | null => {
      if (!d.name.trim()) return t("partners.contacts.error.name");
      if (d.email.trim() && !EMAIL.test(d.email.trim())) return t("partners.contacts.error.email");
      return null;
    },
    [t],
  );

  const errorText = useCallback(
    (result: ActionResult): string | null => {
      if (!result) return null;
      if (result.serverError) return result.serverError.message ?? "Error";
      const err = result.data?.error;
      if (!err) return null;
      if (err.details?.field === "name") return t("partners.contacts.error.name");
      if (err.details?.field === "email") return t("partners.contacts.error.email");
      return err.message;
    },
    [t],
  );

  const reload = useCallback(async () => {
    const r = await execList({ partnerId });
    const list = (r?.data?.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      email: c.email,
      phone: c.phone,
    }));
    setContacts(list);
    onCountChange?.(list.length);
  }, [execList, onCountChange, partnerId]);

  const handleAdd = useCallback(
    async (d: Draft): Promise<boolean> => {
      const invalid = draftError(d);
      if (invalid) {
        toast.error(invalid);
        return false;
      }
      const result = await execCreate({ partnerId, ...d });
      const error = errorText(result as ActionResult);
      if (error) {
        toast.error(error);
        return false;
      }
      toast.success(t("partners.contacts.added"));
      setAdding(false);
      await reload();
      return true;
    },
    [draftError, errorText, execCreate, partnerId, reload, t],
  );

  const handleSave = useCallback(
    async (id: string, d: Draft): Promise<boolean> => {
      const invalid = draftError(d);
      if (invalid) {
        toast.error(invalid);
        return false;
      }
      const result = await execUpdate({ id, ...d });
      const error = errorText(result as ActionResult);
      if (error) {
        toast.error(error);
        return false;
      }
      toast.success(t("partners.contacts.updated"));
      setEditingId(null);
      await reload();
      return true;
    },
    [draftError, errorText, execUpdate, reload, t],
  );

  const handleDelete = useCallback(
    (row: PartnerContactRow) => {
      confirm(
        async () => {
          const result = await execDelete({ id: row.id });
          const error = errorText(result as ActionResult);
          if (error) throw new Error(error);
          toast.success(t("partners.contacts.deleted"));
          await reload();
        },
        { description: t("partners.contacts.deleteConfirm.description", { name: row.name }) },
      );
    },
    [confirm, errorText, execDelete, reload, t],
  );

  return (
    <section className="space-y-2" data-testid="partner-contacts">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("partners.contacts.title")}</h3>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            {t("partners.contacts.add")}
          </Button>
        )}
      </div>

      {adding && (
        <ContactForm
          initial={EMPTY}
          submitLabel={t("common.add")}
          pending={isCreating}
          onSubmit={handleAdd}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("partners.contacts.name")}</TableHead>
              <TableHead>{t("partners.contacts.role")}</TableHead>
              <TableHead>{t("partners.contacts.email")}</TableHead>
              <TableHead>{t("partners.contacts.phone")}</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-12 text-center text-muted-foreground">
                  {t("partners.contacts.empty")}
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((row) =>
                editingId === row.id ? (
                  <TableRow key={row.id} data-testid="contact-row">
                    <TableCell colSpan={5} className="p-2">
                      <ContactForm
                        initial={toDraft(row)}
                        submitLabel={t("common.save")}
                        pending={isUpdating}
                        onSubmit={(d) => handleSave(row.id, d)}
                        onCancel={() => setEditingId(null)}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={row.id} data-testid="contact-row">
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.role ?? "—"}</TableCell>
                    <TableCell>
                      {row.email ? (
                        <a href={`mailto:${row.email}`} className="text-primary hover:underline">
                          {row.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {row.phone ? (
                        <a
                          href={`tel:${row.phone.replace(/[^\d+]/g, "")}`}
                          className="text-primary tabular-nums hover:underline"
                        >
                          {row.phone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={() => setEditingId(row.id)}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={() => handleDelete(row)}
                      >
                        {t("common.delete")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ),
              )
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog {...dialogProps} />
    </section>
  );
}

function ContactForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  pending: boolean;
  onSubmit: (d: Draft) => Promise<boolean>;
  onCancel: () => void;
}) {
  const t = useT();
  const ids = useId();
  const [draft, setDraft] = useState<Draft>(initial);
  const set = (field: Field) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [field]: e.target.value }));
  const fields: { field: Field; inputMode?: "email" | "tel"; className: string }[] = [
    { field: "name", className: "min-w-48 flex-1" },
    { field: "role", className: "w-48" },
    { field: "email", inputMode: "email", className: "min-w-56 flex-1" },
    { field: "phone", inputMode: "tel", className: "w-44" },
  ];

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      {fields.map(({ field, inputMode, className }) => (
        <div key={field} className={className}>
          <label htmlFor={`${ids}-${field}`} className="mb-1 block text-xs font-medium">
            {t(`partners.contacts.${field}`)}
          </label>
          <Input
            id={`${ids}-${field}`}
            inputMode={inputMode}
            value={draft[field]}
            onChange={set(field)}
            maxLength={MAX[field]}
            className="h-8"
            autoFocus={field === "name"}
          />
        </div>
      ))}
      <Button type="submit" size="sm" disabled={pending || !draft.name.trim()}>
        {submitLabel}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        {t("common.cancel")}
      </Button>
    </form>
  );
}
