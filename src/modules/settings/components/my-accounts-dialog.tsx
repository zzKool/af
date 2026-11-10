"use client";

// F187 (D84): *Use my usual accounts* — one button, one confirm dialog that says what happens before anything is
// written: the set (`MY_ACCOUNT_SET`) with its notes, how many are activated and noted, and the *Deactivate the
// others* box (on by default) with the accounts that stay all the same and why.
import { ListChecks, Loader2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/kernel/i18n/use-t";
import { Tag } from "@/kernel/ui/tags";
import {
  applyMyAccountsAction,
  getMyAccountsPlanAction,
} from "@/modules/settings/bas-preferences.actions";
import { MY_ACCOUNT_SET } from "../my-accounts";
import type { BasPreferenceRow, KeptReason, MyAccountsPlan } from "../types";

type Named = { code: string; name: string; nameEn: string | null };

/** The payload of a safe-action result — `{ data }` or `{ error }` inside `data` — or the error's message. */
function unwrap<T>(r: unknown): { data?: T; error?: string } {
  const res = r as {
    serverError?: { message?: string };
    data?: { data?: T; error?: { message?: string } };
  };
  if (res?.serverError) return { error: res.serverError.message || "Server error" };
  if (res?.data?.error) return { error: res.data.error.message || "Action failed" };
  return { data: res?.data?.data };
}

export function MyAccountsDialog({
  categories,
  onApplied,
}: {
  /** the chart, for the names of the set */
  categories: Named[];
  /** the active accounts after the apply — the list replaces its own */
  onApplied: (preferences: BasPreferenceRow[]) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<MyAccountsPlan | null>(null);
  const [deactivateOthers, setDeactivateOthers] = useState(true);
  const { executeAsync: readPlan, isPending: reading } = useAction(getMyAccountsPlanAction);
  const { executeAsync: apply, isPending: applying } = useAction(applyMyAccountsAction);

  const names = new Map(categories.map((c) => [c.code, c.nameEn || c.name]));

  async function openDialog() {
    setPlan(null);
    setDeactivateOthers(true);
    setOpen(true);
    const r = unwrap<MyAccountsPlan>(await readPlan({}));
    if (r.error) {
      toast.error(t("settings.bas.mine.failed", { error: r.error }));
      setOpen(false);
      return;
    }
    setPlan(r.data ?? null);
  }

  async function confirm() {
    const r = unwrap<{ activated: number; deactivated: number; preferences: BasPreferenceRow[] }>(
      await apply({ deactivateOthers }),
    );
    if (r.error || !r.data) {
      toast.error(t("settings.bas.mine.failed", { error: r.error ?? "—" }));
      return;
    }
    onApplied(r.data.preferences);
    toast.success(
      t("settings.bas.mine.done", {
        activated: r.data.activated,
        deactivated: r.data.deactivated,
      }),
    );
    setOpen(false);
  }

  const reason = (k: KeptReason, uses: number) =>
    k === "inUse"
      ? t("settings.bas.mine.reason.inUse", { count: uses })
      : t(`settings.bas.mine.reason.${k}`);
  const activating = new Set(plan?.activate ?? []);
  const nothing =
    plan !== null &&
    plan.activate.length === 0 &&
    plan.notes.length === 0 &&
    plan.deactivate.length === 0;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={openDialog}
        data-testid="bas-use-mine"
        className="shrink-0"
      >
        <ListChecks className="h-3.5 w-3.5" />
        {t("settings.bas.mine.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !applying && setOpen(o)}>
        <DialogContent size="lg" data-testid="bas-mine-dialog">
          <DialogHeader>
            <DialogTitle>{t("settings.bas.mine.title")}</DialogTitle>
            <DialogDescription>{t("settings.bas.mine.intro")}</DialogDescription>
          </DialogHeader>

          {!plan ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {reading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("settings.bas.mine.loading")}
            </p>
          ) : (
            <div className="space-y-4 text-[13px]">
              <section>
                <h3 className="eyebrow mb-1.5">
                  {t("settings.bas.mine.set", { count: MY_ACCOUNT_SET.length })}
                </h3>
                <ul className="divide-y divide-subtle rounded-lg border" data-testid="bas-mine-set">
                  {MY_ACCOUNT_SET.map((a) => (
                    <li key={a.code} className="flex items-baseline gap-2 px-3 py-1.5">
                      <span className="font-mono text-xs tabular-nums">{a.code}</span>
                      <span className="shrink-0 font-medium">{names.get(a.code) ?? ""}</span>
                      <span
                        className="min-w-0 truncate text-xs text-muted-foreground"
                        title={a.useFor}
                      >
                        {a.useFor}
                      </span>
                      {activating.has(a.code) && (
                        <Tag className="ml-auto shrink-0">{t("settings.bas.mine.new")}</Tag>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <ul className="space-y-1" data-testid="bas-mine-summary">
                {nothing ? (
                  <li>{t("settings.bas.mine.nothing")}</li>
                ) : (
                  <>
                    {plan.activate.length > 0 && (
                      <li>{t("settings.bas.mine.activate", { count: plan.activate.length })}</li>
                    )}
                    {plan.notes.length > 0 && (
                      <li>{t("settings.bas.mine.notes", { count: plan.notes.length })}</li>
                    )}
                  </>
                )}
              </ul>

              <label className="flex items-start gap-2">
                <Checkbox
                  checked={deactivateOthers}
                  onCheckedChange={(c) => setDeactivateOthers(c === true)}
                  disabled={plan.deactivate.length === 0}
                  aria-label={t("settings.bas.mine.deactivate", { count: plan.deactivate.length })}
                  data-testid="bas-mine-deactivate"
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">
                    {t("settings.bas.mine.deactivate", { count: plan.deactivate.length })}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("settings.bas.mine.deactivateHint")}
                  </span>
                </span>
              </label>

              {plan.kept.length > 0 && (
                <section data-testid="bas-mine-kept">
                  <p className="mb-1.5 text-xs text-muted-foreground">
                    {t("settings.bas.mine.kept", { count: plan.kept.length })}
                  </p>
                  <ul className="max-h-40 space-y-0.5 overflow-auto text-xs">
                    {plan.kept.map((k) => (
                      <li key={k.code} className="flex gap-2">
                        <span className="truncate">{k.label}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">
                          {k.reasons.map((r) => reason(r, k.uses)).join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={applying}>
              {t("common.cancel")}
            </Button>
            <Button onClick={confirm} disabled={!plan || applying} data-testid="bas-mine-apply">
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("settings.bas.mine.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
