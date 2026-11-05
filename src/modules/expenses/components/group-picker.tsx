"use client";

// The group of a new expense or supplier invoice: an existing group, or "+ New group…" with its description typed
// inline. The dialog keeps the two values (its open / copy-last / reset logic sets them); the group itself is created
// on submit through `useCreateGroupIfNew`, so cancelling the dialog leaves no empty group behind.
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
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
import { createExpenseGroupAction } from "@/modules/expenses/expenses.actions";
import type { GroupOption } from "@/modules/expenses/types";
import type { GroupForProposal } from "../group-proposal";
import { groupLabel } from "./labels";

// the group a paper's date proposes (review 2026-10-31 §5.2, F131): pure, on the client surface for the reading
// dialog and the Expenses pickers — the house pattern for a pure helper beside its picker (`bas-picker.tsx`)
export {
  type GroupForProposal,
  type GroupProposal,
  type GroupProposalReason,
  monthOfGroupName,
  proposeGroupForDate,
} from "../group-proposal";

/** The select value standing for "+ New group…". */
export const NEW_GROUP = "__new__";

/**
 * The group a dialog opens on: the one it was given, else the first, else a new one. The supplier invoice dialog
 * still opens this way; the expense dialog proposes from the date instead (`proposeGroupForDate`, F131 §5.2 — the
 * first of the list is no proposal, lessons *F124 build*).
 */
export const initialGroupId = (groups: GroupOption[], defaultGroupId?: string) =>
  defaultGroupId ?? groups[0]?.id ?? NEW_GROUP;

/** `GroupOption` as the proposal reads it: the group's name and, for a trip, its days. */
export const forProposal = (g: GroupOption): GroupForProposal => ({
  id: g.id,
  name: g.description,
  kind: g.kind,
  departure: g.departure ?? null,
  return: g.return ?? null,
});

/** Two cells of the dialog's two-column grid: the select, and the description input when a new group is picked. */
export function GroupPicker({
  idPrefix,
  label,
  groups,
  value,
  onChange,
  newDescription,
  onNewDescription,
  hint,
}: {
  idPrefix: string;
  label: string;
  groups: GroupOption[];
  value: string;
  onChange: (groupId: string) => void;
  newDescription: string;
  onNewDescription: (description: string) => void;
  /** under the select: where the proposal came from (*proposed (the trip)*), or that nothing fits the date */
  hint?: string | null;
}) {
  const t = useT();
  const isNew = value === NEW_GROUP;
  return (
    <>
      <div className={isNew ? "" : "sm:col-span-2"}>
        <label htmlFor={`${idPrefix}-group`} className="mb-1 block text-xs font-medium">
          {label}
        </label>
        <Select value={value} onValueChange={(v) => v && onChange(v)}>
          <SelectTrigger id={`${idPrefix}-group`} className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {groupLabel(g)}
              </SelectItem>
            ))}
            <SelectItem value={NEW_GROUP}>{t("expenses.form.newGroup")}</SelectItem>
          </SelectContent>
        </Select>
        {hint && (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="group-hint">
            {hint}
          </p>
        )}
      </div>
      {isNew && (
        <div>
          <label htmlFor={`${idPrefix}-newgroup`} className="mb-1 block text-xs font-medium">
            {t("expenses.form.newGroupDescription")}
          </label>
          <Input
            id={`${idPrefix}-newgroup`}
            value={newDescription}
            onChange={(e) => onNewDescription(e.target.value)}
            required
            data-testid="new-group-description"
          />
        </div>
      )}
    </>
  );
}

/**
 * On submit: the picked group's id, or — for "+ New group…" — the id of the group just created from the description.
 * `null` when the creation failed (the error is already toasted).
 */
export function useCreateGroupIfNew() {
  const { executeAsync, isPending } = useAction(createExpenseGroupAction);
  async function resolveGroupId(groupId: string, newDescription: string): Promise<string | null> {
    if (groupId !== NEW_GROUP) return groupId;
    const g = await executeAsync({ description: newDescription.trim() });
    const error = extractError(g);
    if (error) {
      toast.error(error);
      return null;
    }
    return g?.data?.data?.id ?? null;
  }
  return { resolveGroupId, isPending };
}
