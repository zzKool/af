"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import {
  createDocumentTypePrefix,
  deleteDocumentTypePrefix,
  updateDocumentTypePrefix,
} from "@/server/actions/document-type-prefixes";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type DocumentTypePrefix = {
  id: string;
  documentType: string;
  prefix: string;
};

type Props = {
  initialPrefixes: DocumentTypePrefix[];
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

/**
 * Generate an illustrative business key example for a prefix.
 * Pattern: [prefix][date]_[BAS]_[partner]_[sequence].ext
 */
function illustrativeExample(prefix: string): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}${today}_Tr_Lufthansa_001.pdf`;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export function DocumentTypePrefixesTab({ initialPrefixes }: Props) {
  const [prefixes, setPrefixes] = useState<DocumentTypePrefix[]>(initialPrefixes);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const { executeAsync: execCreate, isPending: isCreating } = useAction(createDocumentTypePrefix);
  const { executeAsync: execUpdate } = useAction(updateDocumentTypePrefix);
  const { executeAsync: execDelete } = useAction(deleteDocumentTypePrefix);
  const { dialogProps, confirm } = useConfirmDialog();

  const prefixesRef = useRef(prefixes);
  useEffect(() => {
    prefixesRef.current = prefixes;
  }, [prefixes]);

  // ─── Create ───
  const handleCreate = useCallback(
    async (documentType: string, prefix: string) => {
      const result = await execCreate({ documentType, prefix });
      if (result) {
        const err = actionError(result);
        if (err) {
          toast.error(err);
          return false;
        }
        const newId = result.data?.data?.id;
        if (!newId) {
          toast.error("Failed to create prefix");
          return false;
        }
        setPrefixes((prev) => [...prev, { id: newId, documentType, prefix }]);
        return true;
      }
      return false;
    },
    [execCreate],
  );

  // ─── Update (auto-save onBlur) ───
  const handleUpdatePrefix = useCallback(
    async (id: string, prefix: string) => {
      const item = prefixesRef.current.find((p) => p.id === id);
      if (!item || item.prefix === prefix) return;

      // Optimistic update
      setPrefixes((prev) => prev.map((p) => (p.id === id ? { ...p, prefix } : p)));

      const result = await execUpdate({ id, prefix });
      if (result) {
        const err = actionError(result);
        if (err) {
          toast.error(err);
          // Revert
          setPrefixes((prev) => prev.map((p) => (p.id === id ? { ...p, prefix: item.prefix } : p)));
        }
      }
    },
    [execUpdate],
  );

  // ─── Delete ───
  const handleDelete = useCallback(
    (id: string) => {
      const item = prefixesRef.current.find((p) => p.id === id);
      const name = item?.prefix || "this prefix";
      confirm(
        async () => {
          setDeleting((prev) => new Set(prev).add(id));
          try {
            const result = await execDelete({ id });
            if (result) {
              const err = actionError(result);
              if (err) throw new Error(err);
              setPrefixes((prev) => prev.filter((p) => p.id !== id));
            }
          } finally {
            setDeleting((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }
        },
        { description: `Delete "${name}" document prefix? This cannot be undone.` },
      );
    },
    [execDelete, confirm],
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Business key pattern:{" "}
        <code className="text-xs">[prefix][date]_[BAS]_[partner]_[sequence].ext</code>
      </p>

      {/* Prefix list */}
      {prefixes.map((item) => (
        <PrefixCard
          key={item.id}
          item={item}
          onUpdatePrefix={handleUpdatePrefix}
          onDelete={handleDelete}
          isDeleting={deleting.has(item.id)}
        />
      ))}

      {/* Add form */}
      {showAddForm && (
        <AddPrefixForm
          onCreate={handleCreate}
          onCancel={() => setShowAddForm(false)}
          isCreating={isCreating}
        />
      )}

      {/* Add button */}
      {!showAddForm && (
        <Button variant="outline" onClick={() => setShowAddForm(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add Prefix
        </Button>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Prefix Card
// ─────────────────────────────────────────────────────────────
function PrefixCard({
  item,
  onUpdatePrefix,
  onDelete,
  isDeleting,
}: {
  item: DocumentTypePrefix;
  onUpdatePrefix: (id: string, prefix: string) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const [localPrefix, setLocalPrefix] = useState(item.prefix);

  useEffect(() => {
    setLocalPrefix(item.prefix);
  }, [item.prefix]);

  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-2 py-1 text-xs font-mono font-medium">
            {item.documentType}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(item.id)}
          disabled={isDeleting}
          title="Delete prefix"
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Document Type — read-only after creation */}
        <div>
          <label
            htmlFor={`prefix-type-${item.id}`}
            className="text-[10px] text-muted-foreground uppercase"
          >
            Document Type
          </label>
          <Input
            id={`prefix-type-${item.id}`}
            value={item.documentType}
            disabled
            className="h-8 text-sm bg-muted/50"
          />
        </div>

        {/* Prefix — editable with auto-save onBlur */}
        <div>
          <label
            htmlFor={`prefix-value-${item.id}`}
            className="text-[10px] text-muted-foreground uppercase"
          >
            Prefix
          </label>
          <Input
            id={`prefix-value-${item.id}`}
            value={localPrefix}
            onChange={(e) => setLocalPrefix(e.target.value)}
            onBlur={() => onUpdatePrefix(item.id, localPrefix)}
            className="h-8 text-sm font-mono"
          />
        </div>
      </div>

      {/* Illustrative example */}
      <p className="text-xs text-muted-foreground">
        {illustrativeExample(localPrefix)} <span className="italic">(illustrative)</span>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Add Prefix Form
// ─────────────────────────────────────────────────────────────
function AddPrefixForm({
  onCreate,
  onCancel,
  isCreating,
}: {
  onCreate: (documentType: string, prefix: string) => Promise<boolean>;
  onCancel: () => void;
  isCreating: boolean;
}) {
  const [documentType, setDocumentType] = useState("");
  const [prefix, setPrefix] = useState("");
  const typeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    typeRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedType = documentType.trim().toLowerCase();
    const trimmedPrefix = prefix.trim().toLowerCase();

    if (!trimmedType) {
      toast.error("Document type is required");
      return;
    }
    if (!trimmedPrefix) {
      toast.error("Prefix is required");
      return;
    }

    const success = await onCreate(trimmedType, trimmedPrefix);
    if (success) {
      setDocumentType("");
      setPrefix("");
      onCancel();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <h3 className="text-sm font-medium">Add Document Prefix</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="prefix-add-type" className="text-[10px] text-muted-foreground uppercase">
            Document Type
          </label>
          <Input
            id="prefix-add-type"
            ref={typeRef}
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value.toLowerCase())}
            placeholder="e.g., expense, invoice"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label htmlFor="prefix-add-value" className="text-[10px] text-muted-foreground uppercase">
            Prefix
          </label>
          <Input
            id="prefix-add-value"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toLowerCase())}
            placeholder="e.g., exp_"
            className="h-8 text-sm font-mono"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isCreating}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isCreating}>
          {isCreating ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Adding...
            </>
          ) : (
            "Add Prefix"
          )}
        </Button>
      </div>
    </form>
  );
}
