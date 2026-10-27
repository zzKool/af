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
import type { CategorisationRuleDto, RuleMatchField, RuleMatchType } from "@/modules/banking/types";
import type { CategoryOption, PartnerOption } from "./categorise-form";

const NONE = "__none__";
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
};

export function RuleDialog({
  open,
  onOpenChange,
  rule,
  initial,
  fromTransactionId,
  categories,
  partners,
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
  };
}
