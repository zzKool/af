"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/kernel/i18n/use-t";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  createVatRegistrationAction,
  deleteVatRegistrationAction,
  updateVatRegistrationAction,
} from "@/modules/settings/vat-registrations.actions";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type VatRegistration = {
  id: string;
  country: string;
  vatNumber: string;
  rateSchedule: { rates: number[] } | null;
};

type Props = {
  initialRegistrations: VatRegistration[];
};

// ─────────────────────────────────────────────────────────────
// Rate input parser — pure function for testability
// ─────────────────────────────────────────────────────────────

/**
 * Parse a raw rate input string into a clean number array.
 * Lenient: strips %, splits on comma/space, ignores empty segments and NaN.
 */
export function parseRateInput(raw: string): number[] {
  return raw
    .replace(/%/g, "")
    .split(/[,\s]+/)
    .filter((s) => s.length > 0)
    .map((s) => Number.parseFloat(s))
    .filter((n) => !Number.isNaN(n));
}

/** Extract error message from a server action result */
function actionError(result: {
  serverError?: unknown;
  data?: { error?: { message?: string } };
}): string | null {
  if (result.serverError) {
    const se = result.serverError as { message?: string };
    return se.message || "Server error";
  }
  if (result.data?.error) return result.data.error.message || "Action failed";
  return null;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export function VatRegistrationsTab({ initialRegistrations }: Props) {
  const [registrations, setRegistrations] = useState<VatRegistration[]>(initialRegistrations);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const { executeAsync: execCreate, isPending: isCreating } = useAction(
    createVatRegistrationAction,
  );
  const { executeAsync: execUpdate } = useAction(updateVatRegistrationAction);
  const { executeAsync: execDelete } = useAction(deleteVatRegistrationAction);
  const t = useT();
  const { dialogProps, confirm } = useConfirmDialog();

  // Ref to avoid stale closures in update callbacks
  const registrationsRef = useRef(registrations);
  useEffect(() => {
    registrationsRef.current = registrations;
  }, [registrations]);

  // ─── Create ───
  const handleCreate = useCallback(
    async (country: string, vatNumber: string, rateScheduleRaw: string) => {
      const rates = parseRateInput(rateScheduleRaw);
      const rateSchedule = rates.length > 0 ? { rates } : undefined;

      const result = await execCreate({ country, vatNumber, rateSchedule });
      if (result) {
        const err = actionError(result);
        if (err) {
          toast.error(err);
          return false;
        }
        const newId = result.data?.data?.id;
        if (!newId) {
          toast.error(t("settings.vat.createFailed"));
          return false;
        }
        setRegistrations((prev) => [
          ...prev,
          {
            id: newId,
            country: country.toUpperCase(),
            vatNumber,
            rateSchedule: rateSchedule ?? null,
          },
        ]);
        return true;
      }
      return false;
    },
    [execCreate, t],
  );

  // ─── Update (auto-save onBlur) ───
  const handleUpdateVatNumber = useCallback(
    async (id: string, vatNumber: string) => {
      const reg = registrationsRef.current.find((r) => r.id === id);
      if (!reg || reg.vatNumber === vatNumber) return;

      // Optimistic update
      setRegistrations((prev) => prev.map((r) => (r.id === id ? { ...r, vatNumber } : r)));

      const result = await execUpdate({ id, vatNumber });
      if (result) {
        const err = actionError(result);
        if (err) {
          toast.error(err);
          // Revert
          setRegistrations((prev) =>
            prev.map((r) => (r.id === id ? { ...r, vatNumber: reg.vatNumber } : r)),
          );
        }
      }
    },
    [execUpdate],
  );

  const handleUpdateRateSchedule = useCallback(
    async (id: string, rawRates: string) => {
      const reg = registrationsRef.current.find((r) => r.id === id);
      if (!reg) return;

      const rates = parseRateInput(rawRates);
      const rateSchedule = rates.length > 0 ? { rates } : null;

      // Check if unchanged
      const oldRates = reg.rateSchedule?.rates ?? [];
      if (JSON.stringify(rates) === JSON.stringify(oldRates)) return;

      // Optimistic update
      setRegistrations((prev) => prev.map((r) => (r.id === id ? { ...r, rateSchedule } : r)));

      const result = await execUpdate({ id, rateSchedule });
      if (result) {
        const err = actionError(result);
        if (err) {
          toast.error(err);
          setRegistrations((prev) =>
            prev.map((r) => (r.id === id ? { ...r, rateSchedule: reg.rateSchedule } : r)),
          );
        }
      }
    },
    [execUpdate],
  );

  // ─── Delete ───
  const handleDelete = useCallback(
    (id: string) => {
      const reg = registrationsRef.current.find((r) => r.id === id);
      const name = reg?.country ?? "";
      confirm(
        async () => {
          setDeleting((prev) => new Set(prev).add(id));
          try {
            const result = await execDelete({ id });
            if (result) {
              const err = actionError(result);
              if (err) throw new Error(err);
              setRegistrations((prev) => prev.filter((r) => r.id !== id));
            }
          } finally {
            setDeleting((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }
        },
        { description: t("settings.vat.deleteConfirm", { name }) },
      );
    },
    [execDelete, confirm, t],
  );

  return (
    <div className="space-y-4">
      {/* Empty state */}
      {registrations.length === 0 && !showAddForm && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">{t("settings.vat.empty")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.vat.emptyHint")}</p>
          <Button variant="default" className="mt-4" onClick={() => setShowAddForm(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("settings.vat.add")}
          </Button>
        </div>
      )}

      {/* Registration list */}
      {registrations.map((reg) => (
        <RegistrationCard
          key={reg.id}
          registration={reg}
          onUpdateVatNumber={handleUpdateVatNumber}
          onUpdateRateSchedule={handleUpdateRateSchedule}
          onDelete={handleDelete}
          isDeleting={deleting.has(reg.id)}
        />
      ))}

      {/* Add form */}
      {showAddForm && (
        <AddRegistrationForm
          onCreate={handleCreate}
          onCancel={() => setShowAddForm(false)}
          isCreating={isCreating}
        />
      )}

      {/* Add button (when registrations exist and form is hidden) */}
      {registrations.length > 0 && !showAddForm && (
        <Button variant="outline" onClick={() => setShowAddForm(true)}>
          <Plus className="mr-1 h-4 w-4" />
          {t("settings.vat.add")}
        </Button>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Registration Card
// ─────────────────────────────────────────────────────────────
function RegistrationCard({
  registration,
  onUpdateVatNumber,
  onUpdateRateSchedule,
  onDelete,
  isDeleting,
}: {
  registration: VatRegistration;
  onUpdateVatNumber: (id: string, vatNumber: string) => void;
  onUpdateRateSchedule: (id: string, rawRates: string) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const t = useT();
  const [localVatNumber, setLocalVatNumber] = useState(registration.vatNumber);
  const [localRates, setLocalRates] = useState(registration.rateSchedule?.rates.join(", ") ?? "");

  // Sync when props change (e.g., after server response)
  useEffect(() => {
    setLocalVatNumber(registration.vatNumber);
  }, [registration.vatNumber]);

  useEffect(() => {
    setLocalRates(registration.rateSchedule?.rates.join(", ") ?? "");
  }, [registration.rateSchedule]);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-2 py-1 text-xs font-mono font-medium">
            {registration.country}
          </span>
          <span className="text-sm font-medium">{registration.vatNumber}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(registration.id)}
          disabled={isDeleting}
          title={t("settings.vat.delete")}
          aria-label={t("settings.vat.delete")}
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Country — read-only after creation */}
        <div>
          <label
            htmlFor={`vat-country-${registration.id}`}
            className="text-[10px] text-muted-foreground uppercase"
          >
            {t("settings.vat.country")}
          </label>
          <Input
            id={`vat-country-${registration.id}`}
            value={registration.country}
            disabled
            className="h-8 text-sm bg-muted/50"
          />
        </div>

        {/* VAT Number — editable with auto-save onBlur */}
        <div>
          <label
            htmlFor={`vat-number-${registration.id}`}
            className="text-[10px] text-muted-foreground uppercase"
          >
            {t("settings.vat.number")}
          </label>
          <Input
            id={`vat-number-${registration.id}`}
            value={localVatNumber}
            onChange={(e) => setLocalVatNumber(e.target.value)}
            onBlur={() => onUpdateVatNumber(registration.id, localVatNumber)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* Rate schedule */}
      <div>
        <label
          htmlFor={`vat-rates-${registration.id}`}
          className="text-[10px] text-muted-foreground uppercase"
        >
          {t("settings.vat.rates")}
        </label>
        <Input
          id={`vat-rates-${registration.id}`}
          value={localRates}
          onChange={(e) => setLocalRates(e.target.value)}
          onBlur={() => onUpdateRateSchedule(registration.id, localRates)}
          placeholder={t("settings.vat.ratesPlaceholder")}
          className="h-8 text-sm"
        />
        {/* Display parsed rates as pills */}
        {registration.rateSchedule?.rates && registration.rateSchedule.rates.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {registration.rateSchedule.rates.map((rate) => (
              <span
                key={`rate-${rate}`}
                className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                {rate}%
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.vat.noRates")}</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Add Registration Form
// ─────────────────────────────────────────────────────────────
function AddRegistrationForm({
  onCreate,
  onCancel,
  isCreating,
}: {
  onCreate: (country: string, vatNumber: string, rateSchedule: string) => Promise<boolean>;
  onCancel: () => void;
  isCreating: boolean;
}) {
  const t = useT();
  const [country, setCountry] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [rateSchedule, setRateSchedule] = useState("");
  const countryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    countryRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCountry = country.trim().toUpperCase();
    const trimmedVatNumber = vatNumber.trim();

    if (trimmedCountry.length !== 2) {
      toast.error(t("settings.vat.countryInvalid"));
      return;
    }
    if (!trimmedVatNumber) {
      toast.error(t("settings.vat.numberRequired"));
      return;
    }

    const success = await onCreate(trimmedCountry, trimmedVatNumber, rateSchedule);
    if (success) {
      setCountry("");
      setVatNumber("");
      setRateSchedule("");
      onCancel();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <h3 className="text-sm font-medium">{t("settings.vat.addTitle")}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="vat-add-country" className="text-[10px] text-muted-foreground uppercase">
            {t("settings.vat.countryCode")}
          </label>
          <Input
            id="vat-add-country"
            ref={countryRef}
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
            placeholder="SE"
            maxLength={2}
            className="h-8 text-sm uppercase"
          />
        </div>
        <div>
          <label htmlFor="vat-add-number" className="text-[10px] text-muted-foreground uppercase">
            {t("settings.vat.number")}
          </label>
          <Input
            id="vat-add-number"
            value={vatNumber}
            onChange={(e) => setVatNumber(e.target.value)}
            placeholder="SE556677889001"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label htmlFor="vat-add-rates" className="text-[10px] text-muted-foreground uppercase">
            {t("settings.vat.ratesOptional")}
          </label>
          <Input
            id="vat-add-rates"
            value={rateSchedule}
            onChange={(e) => setRateSchedule(e.target.value)}
            placeholder="25, 12, 6"
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isCreating}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={isCreating}>
          {isCreating ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("settings.vat.adding")}
            </>
          ) : (
            t("settings.vat.add")
          )}
        </Button>
      </div>
    </form>
  );
}
