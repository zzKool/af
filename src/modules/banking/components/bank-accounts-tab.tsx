"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCIES } from "@/kernel/nav/constants";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  createBankAccountAction,
  deleteBankAccountAction,
  updateBankAccountAction,
} from "@/modules/banking/bank-accounts.actions";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type BankFormat = {
  id: string;
  name: string;
  bankName: string;
  delimiter: string;
  decimalSeparator: string;
  dateFormat: string;
  encoding: string;
};

type BankAccount = {
  id: string;
  accountAlias: string | null;
  accountNumber: string;
  currency: string;
  bankFormatId: string;
  bankFormat: BankFormat;
};

type Props = {
  initialAccounts: BankAccount[];
  bankFormats: BankFormat[];
};

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
export function BankAccountsTab({ initialAccounts, bankFormats }: Props) {
  const [accounts, setAccounts] = useState<BankAccount[]>(initialAccounts);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const { executeAsync: execCreate, isPending: isCreating } = useAction(createBankAccountAction);
  const { executeAsync: execUpdate } = useAction(updateBankAccountAction);
  const { executeAsync: execDelete } = useAction(deleteBankAccountAction);
  const { dialogProps, confirm } = useConfirmDialog();

  // Ref to avoid stale closures in update callbacks
  const accountsRef = useRef(accounts);
  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  // ─── Create ───
  const handleCreate = useCallback(
    async (input: {
      accountAlias?: string;
      accountNumber: string;
      currency: string;
      bankFormatId: string;
    }) => {
      const result = await execCreate(input);
      if (result) {
        const err = actionError(result);
        if (err) {
          toast.error(err);
          return false;
        }
        const newId = result.data?.data?.id;
        if (!newId) {
          toast.error("Failed to create bank account");
          return false;
        }
        const format = bankFormats.find((f) => f.id === input.bankFormatId);
        if (!format) return false;
        setAccounts((prev) => [
          ...prev,
          {
            id: newId,
            accountAlias: input.accountAlias || null,
            accountNumber: input.accountNumber,
            currency: input.currency,
            bankFormatId: input.bankFormatId,
            bankFormat: format,
          },
        ]);
        return true;
      }
      return false;
    },
    [execCreate, bankFormats],
  );

  // ─── Update (auto-save) ───
  const handleUpdateField = useCallback(
    async (
      id: string,
      field: "accountAlias" | "accountNumber" | "currency" | "bankFormatId",
      value: string | null,
    ) => {
      const account = accountsRef.current.find((a) => a.id === id);
      if (!account) return;

      // Skip if unchanged
      const currentValue = account[field];
      if (currentValue === value) return;

      // Optimistic update
      setAccounts((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          const updated = { ...a, [field]: value };
          if (field === "bankFormatId") {
            const format = bankFormats.find((f) => f.id === value);
            if (format) updated.bankFormat = format;
          }
          return updated;
        }),
      );

      const result = await execUpdate({ id, [field]: value });
      if (result) {
        const err = actionError(result);
        if (err) {
          toast.error(err);
          // Revert
          setAccounts((prev) =>
            prev.map((a) => {
              if (a.id !== id) return a;
              return { ...account };
            }),
          );
        }
      }
    },
    [execUpdate, bankFormats],
  );

  // ─── Delete ───
  const handleDelete = useCallback(
    (id: string) => {
      const account = accountsRef.current.find((a) => a.id === id);
      const name = account?.accountAlias || account?.accountNumber || "this account";
      confirm(
        async () => {
          setDeleting((prev) => new Set(prev).add(id));
          try {
            const result = await execDelete({ id });
            if (result) {
              const err = actionError(result);
              if (err) throw new Error(err);
              setAccounts((prev) => prev.filter((a) => a.id !== id));
            }
          } finally {
            setDeleting((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }
        },
        { description: `Delete "${name}" bank account? This cannot be undone.` },
      );
    },
    [execDelete, confirm],
  );

  return (
    <div className="space-y-4">
      {/* Empty state */}
      {accounts.length === 0 && !showAddForm && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">No bank accounts configured yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add your bank accounts and select the CSV format each account uses for importing
            transactions.
          </p>
          <Button variant="default" className="mt-4" onClick={() => setShowAddForm(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add Bank Account
          </Button>
        </div>
      )}

      {/* Account list */}
      {accounts.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          bankFormats={bankFormats}
          onUpdateField={handleUpdateField}
          onDelete={handleDelete}
          isDeleting={deleting.has(account.id)}
        />
      ))}

      {/* Add form */}
      {showAddForm && (
        <AddAccountForm
          bankFormats={bankFormats}
          onCreate={handleCreate}
          onClose={() => setShowAddForm(false)}
          isCreating={isCreating}
        />
      )}

      {/* Add button (when accounts exist and form is hidden) */}
      {accounts.length > 0 && !showAddForm && (
        <Button variant="outline" onClick={() => setShowAddForm(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add Bank Account
        </Button>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Account Card
// ─────────────────────────────────────────────────────────────
function AccountCard({
  account,
  bankFormats,
  onUpdateField,
  onDelete,
  isDeleting,
}: {
  account: BankAccount;
  bankFormats: BankFormat[];
  onUpdateField: (
    id: string,
    field: "accountAlias" | "accountNumber" | "currency" | "bankFormatId",
    value: string | null,
  ) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const [localAlias, setLocalAlias] = useState(account.accountAlias ?? "");
  const [localAccountNumber, setLocalAccountNumber] = useState(account.accountNumber);

  // Sync when props change (e.g., after server response)
  useEffect(() => {
    setLocalAlias(account.accountAlias ?? "");
  }, [account.accountAlias]);

  useEffect(() => {
    setLocalAccountNumber(account.accountNumber);
  }, [account.accountNumber]);

  const title = account.accountAlias || `${account.bankFormat.bankName} - ${account.accountNumber}`;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono font-medium">
            {account.currency}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(account.id)}
          disabled={isDeleting}
          title="Delete bank account"
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Alias — editable with auto-save onBlur */}
        <div>
          <label
            htmlFor={`ba-alias-${account.id}`}
            className="text-[10px] text-muted-foreground uppercase"
          >
            Alias (optional)
          </label>
          <Input
            id={`ba-alias-${account.id}`}
            value={localAlias}
            onChange={(e) => setLocalAlias(e.target.value)}
            onBlur={() => onUpdateField(account.id, "accountAlias", localAlias || null)}
            placeholder="e.g., Plusgiro SEK"
            className="h-8 text-sm"
          />
        </div>

        {/* Account Number — editable with auto-save onBlur */}
        <div>
          <label
            htmlFor={`ba-number-${account.id}`}
            className="text-[10px] text-muted-foreground uppercase"
          >
            Account Number
          </label>
          <Input
            id={`ba-number-${account.id}`}
            value={localAccountNumber}
            onChange={(e) => setLocalAccountNumber(e.target.value)}
            onBlur={() => onUpdateField(account.id, "accountNumber", localAccountNumber)}
            className="h-8 text-sm"
          />
        </div>

        {/* Currency — select with auto-save onChange */}
        <div>
          <Label
            htmlFor={`ba-currency-${account.id}`}
            className="text-[10px] text-muted-foreground uppercase"
          >
            Currency
          </Label>
          <Select
            value={account.currency}
            onValueChange={(value) => {
              if (!value) return;
              onUpdateField(account.id, "currency", value);
            }}
          >
            <SelectTrigger id={`ba-currency-${account.id}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bank Format — select with auto-save onChange */}
        <div>
          <Label
            htmlFor={`ba-format-${account.id}`}
            className="text-[10px] text-muted-foreground uppercase"
          >
            CSV Format
          </Label>
          <Select
            value={account.bankFormatId}
            onValueChange={(value) => {
              if (!value) return;
              onUpdateField(account.id, "bankFormatId", value);
            }}
          >
            <SelectTrigger id={`ba-format-${account.id}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {bankFormats.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Format details for verification */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>
          Delimiter: <span className="font-mono">{account.bankFormat.delimiter}</span>
        </span>
        <span>
          Decimal: <span className="font-mono">{account.bankFormat.decimalSeparator}</span>
        </span>
        <span>
          Date: <span className="font-mono">{account.bankFormat.dateFormat}</span>
        </span>
        <span>
          Encoding: <span className="font-mono">{account.bankFormat.encoding}</span>
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Add Account Form
// ─────────────────────────────────────────────────────────────
function AddAccountForm({
  bankFormats,
  onCreate,
  onClose,
  isCreating,
}: {
  bankFormats: BankFormat[];
  onCreate: (input: {
    accountAlias?: string;
    accountNumber: string;
    currency: string;
    bankFormatId: string;
  }) => Promise<boolean>;
  onClose: () => void;
  isCreating: boolean;
}) {
  const [accountNumber, setAccountNumber] = useState("");
  const [currency, setCurrency] = useState<string>(CURRENCIES[0]);
  const [bankFormatId, setBankFormatId] = useState<string>(
    bankFormats.length === 1 ? bankFormats[0].id : "",
  );
  const [alias, setAlias] = useState("");
  const accountNumberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    accountNumberRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNumber = accountNumber.trim();
    const trimmedAlias = alias.trim();

    if (!trimmedNumber) {
      toast.error("Account number is required");
      return;
    }
    if (!bankFormatId) {
      toast.error("Please select a CSV format");
      return;
    }

    const success = await onCreate({
      accountNumber: trimmedNumber,
      currency,
      bankFormatId,
      accountAlias: trimmedAlias || undefined,
    });
    if (success) {
      setAccountNumber("");
      setAlias("");
      setCurrency(CURRENCIES[0]);
      setBankFormatId(bankFormats.length === 1 ? bankFormats[0].id : "");
      onClose();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <h3 className="text-sm font-medium">Add Bank Account</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ba-add-number" className="text-[10px] text-muted-foreground uppercase">
            Account Number
          </label>
          <Input
            id="ba-add-number"
            ref={accountNumberRef}
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="211 53 13-5"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label htmlFor="ba-add-alias" className="text-[10px] text-muted-foreground uppercase">
            Alias (optional)
          </label>
          <Input
            id="ba-add-alias"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="e.g., Plusgiro SEK"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="ba-add-currency" className="text-[10px] text-muted-foreground uppercase">
            Currency
          </Label>
          <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
            <SelectTrigger id="ba-add-currency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="ba-add-format" className="text-[10px] text-muted-foreground uppercase">
            CSV Format
          </Label>
          <Select value={bankFormatId} onValueChange={(v) => v && setBankFormatId(v)}>
            <SelectTrigger id="ba-add-format" className="w-full">
              <SelectValue placeholder="Select format..." />
            </SelectTrigger>
            <SelectContent>
              {bankFormats.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isCreating}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isCreating}>
          {isCreating ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Adding...
            </>
          ) : (
            "Add Account"
          )}
        </Button>
      </div>
    </form>
  );
}
