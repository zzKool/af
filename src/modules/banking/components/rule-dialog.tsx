"use client";

// Create / edit a categorisation rule — also "create rule from this transaction" (pre-filled, learned).
// Regex sits behind "Advanced"; "Test" counts the newest uncategorised rows the pattern would hit.
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import {
  createRuleAction,
  createRuleFromTransactionAction,
  testRuleAction,
  updateRuleAction,
} from "@/modules/banking/banking.actions";
import type {
  CategorisationRuleDto,
  RuleCadence,
  RuleMatchField,
  RuleMatchType,
  RuleSign,
} from "@/modules/banking/types";
import type { CategoryOption, PartnerOption } from "./categorise-form";

const NONE = "__none__";
const SIGNS: RuleSign[] = ["any", "in", "out"];
const CADENCES: RuleCadence[] = ["none", "monthly", "quarterly", "yearly"];

/** An account a rule may be bound to (the statement accounts — a private instrument has no rows). */
export type RuleAccountOption = { id: string; label: string };
const TYPES: RuleMatchType[] = ["contains", "starts_with", "ends_with", "exact", "regex"];
const FIELDS: RuleMatchField[] = [
  "counterparty_key",
  "name",
  "details",
  "message",
  "sender",
  "recipient",
  "all",
];

export type RuleEditable = Pick<
  CategorisationRuleDto,
  | "id"
  | "name"
  | "matchType"
  | "matchPattern"
  | "matchField"
  | "basCode"
  | "partnerId"
  | "noDocumentNeeded"
  | "priority"
  | "bankAccountId"
  | "sign"
  | "expectedAmount"
  | "tolerancePct"
  | "cadence"
>;

export type RuleDraft = {
  name: string;
  matchType: RuleMatchType;
  matchPattern: string;
  matchField: RuleMatchField;
  basCode: string | null;
  partnerId: string | null;
  noDocumentNeeded: boolean;
  priority: number;
  /** F116 PR C1 — the conditions beyond the text */
  bankAccountId: string | null;
  sign: RuleSign;
  expectedAmount: string;
  tolerancePct: string;
  cadence: RuleCadence;
};

export function RuleDialog({
  open,
  onOpenChange,
  rule,
  initial,
  fromTransactionId,
  categories,
  partners,
  accounts = [],
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** editing an existing rule */
  rule?: RuleEditable | null;
  /** pre-fill for a new rule (from a transaction) */
  initial?: Partial<RuleDraft>;
  /** when set, the rule is created from this transaction (learned) and applied to it */
  fromTransactionId?: string | null;
  categories: CategoryOption[];
  partners: PartnerOption[];
  /** the accounts a rule may be bound to */
  accounts?: RuleAccountOption[];
  onSaved?: (rule: CategorisationRuleDto) => void;
}) {
  const t = useT();
  const ids = useId();
  const [draft, setDraft] = useState<RuleDraft>(() => fromRule(rule, initial));
  const [advanced, setAdvanced] = useState(false);
  const [testResult, setTestResult] = useState<{ matches: number; tested: number } | null>(null);
  const { executeAsync: create, isPending: creating } = useAction(createRuleAction);
  const { executeAsync: update, isPending: updating } = useAction(updateRuleAction);
  const { executeAsync: learn, isPending: learning } = useAction(createRuleFromTransactionAction);
  const { executeAsync: test, isPending: testing } = useAction(testRuleAction);
  const pending = creating || updating || learning;

  // reset when the dialog opens — `initial` is a fresh object on every parent render, so it is read through a
  // ref rather than listed as a dependency (it would reset the form on every keystroke of the parent)
  const latest = useRef({ rule, initial });
  latest.current = { rule, initial };
  useEffect(() => {
    if (!open) return;
    const { rule: r, initial: i } = latest.current;
    setDraft(fromRule(r, i));
    setAdvanced(r?.matchType === "regex" || i?.matchType === "regex");
    setTestResult(null);
  }, [open]);

  async function runTest() {
    const r = await test({
      matchType: draft.matchType,
      matchPattern: draft.matchPattern,
      matchField: draft.matchField,
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    if (r?.data?.data) setTestResult(r.data.data);
  }

  async function submit() {
    const payload = {
      name: draft.name.trim(),
      matchType: draft.matchType,
      matchPattern: draft.matchPattern.trim(),
      matchField: draft.matchField,
      basCode: draft.basCode,
      partnerId: draft.partnerId,
      noDocumentNeeded: draft.noDocumentNeeded,
      priority: draft.priority,
      bankAccountId: draft.bankAccountId,
      sign: draft.sign,
      expectedAmount: draft.expectedAmount.trim() ? draft.expectedAmount.trim() : null,
      tolerancePct: draft.tolerancePct.trim() || "0.5",
      cadence: draft.cadence,
    };
    const r = rule
      ? await update({ id: rule.id, ...payload })
      : fromTransactionId
        ? await learn({ transactionId: fromTransactionId, ...payload })
        : await create(payload);
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("banking.rules.form.saved"));
    const saved = r?.data?.data as CategorisationRuleDto | undefined;
    if (saved) onSaved?.(saved);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="rule-dialog">
        <DialogHeader>
          <DialogTitle>{t("banking.rules.form.title")}</DialogTitle>
          <DialogDescription>
            {fromTransactionId ? t("banking.panel.createRule") : t("banking.rules.title")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <label htmlFor={`${ids}-name`} className="mb-1 block text-xs font-medium">
              {t("banking.rules.form.name")}
            </label>
            <Input
              id={`${ids}-name`}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <div>
              <label htmlFor={`${ids}-type`} className="mb-1 block text-xs font-medium">
                {t("banking.rules.form.type")}
              </label>
              <Select
                value={draft.matchType}
                onValueChange={(v) => v && setDraft({ ...draft, matchType: v as RuleMatchType })}
              >
                <SelectTrigger id={`${ids}-type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.filter((x) => advanced || x !== "regex").map((x) => (
                    <SelectItem key={x} value={x}>
                      {t(`banking.rules.type.${x}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor={`${ids}-pattern`} className="mb-1 block text-xs font-medium">
                {t("banking.rules.form.pattern")}
              </label>
              <Input
                id={`${ids}-pattern`}
                value={draft.matchPattern}
                onChange={(e) => setDraft({ ...draft, matchPattern: e.target.value })}
                required
                className="font-mono"
              />
            </div>
          </div>
          <div>
            <label htmlFor={`${ids}-field`} className="mb-1 block text-xs font-medium">
              {t("banking.rules.form.field")}
            </label>
            <Select
              value={draft.matchField}
              onValueChange={(v) => v && setDraft({ ...draft, matchField: v as RuleMatchField })}
            >
              <SelectTrigger id={`${ids}-field`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELDS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {t(`banking.rules.field.${f}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor={`${ids}-cat`} className="mb-1 block text-xs font-medium">
              {t("banking.rules.form.category")}
            </label>
            <Select
              value={draft.basCode ?? NONE}
              onValueChange={(v) => setDraft({ ...draft, basCode: !v || v === NONE ? null : v })}
            >
              <SelectTrigger id={`${ids}-cat`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("banking.rules.form.noCategory")}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor={`${ids}-partner`} className="mb-1 block text-xs font-medium">
              {t("banking.rules.form.partner")}
            </label>
            <Select
              value={draft.partnerId ?? NONE}
              onValueChange={(v) => setDraft({ ...draft, partnerId: !v || v === NONE ? null : v })}
            >
              <SelectTrigger id={`${ids}-partner`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("banking.rules.form.noPartner")}</SelectItem>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* F116 PR C1: only when… — the account, the direction, the amount, the rhythm */}
          <fieldset
            className="grid gap-2 rounded-md border border-subtle p-2"
            data-testid="rule-conditions"
          >
            <legend className="px-1 text-xs font-medium">{t("banking.rules.form.onlyWhen")}</legend>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={`${ids}-account`} className="mb-1 block text-xs">
                  {t("banking.rules.form.account")}
                </label>
                <Select
                  value={draft.bankAccountId ?? NONE}
                  onValueChange={(v) =>
                    setDraft({ ...draft, bankAccountId: !v || v === NONE ? null : v })
                  }
                >
                  <SelectTrigger
                    id={`${ids}-account`}
                    className="w-full"
                    data-testid="rule-account"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("banking.rules.form.anyAccount")}</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor={`${ids}-sign`} className="mb-1 block text-xs">
                  {t("banking.rules.form.sign")}
                </label>
                <Select
                  value={draft.sign}
                  onValueChange={(v) => v && setDraft({ ...draft, sign: v as RuleSign })}
                >
                  <SelectTrigger id={`${ids}-sign`} className="w-full" data-testid="rule-sign">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SIGNS.map((x) => (
                      <SelectItem key={x} value={x}>
                        {t(`banking.rules.sign.${x}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_6rem_1fr] gap-2">
              <div>
                <label htmlFor={`${ids}-amount`} className="mb-1 block text-xs">
                  {t("banking.rules.form.expectedAmount")}
                </label>
                <Input
                  id={`${ids}-amount`}
                  inputMode="decimal"
                  placeholder={t("banking.rules.form.anyAmount")}
                  value={draft.expectedAmount}
                  onChange={(e) => setDraft({ ...draft, expectedAmount: e.target.value })}
                  className="text-right tabular-nums"
                  data-testid="rule-amount"
                />
              </div>
              <div>
                <label htmlFor={`${ids}-tol`} className="mb-1 block text-xs">
                  {t("banking.rules.form.tolerance")}
                </label>
                <Input
                  id={`${ids}-tol`}
                  inputMode="decimal"
                  value={draft.tolerancePct}
                  onChange={(e) => setDraft({ ...draft, tolerancePct: e.target.value })}
                  className="text-right tabular-nums"
                  disabled={!draft.expectedAmount.trim()}
                />
              </div>
              <div>
                <label htmlFor={`${ids}-cadence`} className="mb-1 block text-xs">
                  {t("banking.rules.form.cadence")}
                </label>
                <Select
                  value={draft.cadence}
                  onValueChange={(v) => v && setDraft({ ...draft, cadence: v as RuleCadence })}
                >
                  <SelectTrigger
                    id={`${ids}-cadence`}
                    className="w-full"
                    data-testid="rule-cadence"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CADENCES.map((x) => (
                      <SelectItem key={x} value={x}>
                        {t(`banking.rules.cadence.${x}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("banking.rules.form.conditionsHint")}
            </p>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${ids}-nodoc`}
              checked={draft.noDocumentNeeded}
              onCheckedChange={(c) => setDraft({ ...draft, noDocumentNeeded: c === true })}
              aria-label={t("banking.rules.form.noDocument")}
            />
            <span>{t("banking.rules.form.noDocument")}</span>
          </label>
          <div className="flex items-end gap-3">
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => setAdvanced((a) => !a)}
            >
              {t("banking.rules.form.advanced")}
            </button>
            {advanced && (
              <div>
                <label htmlFor={`${ids}-prio`} className="mb-1 block text-xs font-medium">
                  {t("banking.rules.form.priority")}
                </label>
                <Input
                  id={`${ids}-prio`}
                  type="number"
                  min={0}
                  max={999}
                  value={draft.priority}
                  onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })}
                  className="w-24"
                />
              </div>
            )}
            <div className="ml-auto flex items-center gap-2 text-xs">
              {testResult && (
                <span className="text-muted-foreground" data-testid="rule-test-result">
                  {t("banking.rules.form.testResult", testResult)}
                </span>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void runTest()}
                disabled={testing || !draft.matchPattern.trim()}
              >
                {t("banking.rules.form.test")}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("banking.rules.form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function fromRule(rule: RuleEditable | null | undefined, initial?: Partial<RuleDraft>): RuleDraft {
  if (rule) {
    return {
      name: rule.name,
      matchType: rule.matchType,
      matchPattern: rule.matchPattern,
      matchField: rule.matchField,
      basCode: rule.basCode,
      partnerId: rule.partnerId,
      noDocumentNeeded: rule.noDocumentNeeded,
      priority: rule.priority,
      bankAccountId: rule.bankAccountId,
      sign: rule.sign,
      expectedAmount: rule.expectedAmount ?? "",
      tolerancePct: rule.tolerancePct,
      cadence: rule.cadence,
    };
  }
  return {
    name: initial?.name ?? "",
    matchType: initial?.matchType ?? "contains",
    matchPattern: initial?.matchPattern ?? "",
    matchField: initial?.matchField ?? "counterparty_key",
    basCode: initial?.basCode ?? null,
    partnerId: initial?.partnerId ?? null,
    noDocumentNeeded: initial?.noDocumentNeeded ?? false,
    priority: initial?.priority ?? 100,
    bankAccountId: initial?.bankAccountId ?? null,
    sign: initial?.sign ?? "any",
    expectedAmount: initial?.expectedAmount ?? "",
    tolerancePct: initial?.tolerancePct ?? "0.50",
    cadence: initial?.cadence ?? "none",
  };
}
