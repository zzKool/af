// A linkable's label with its business key as a `<CodeChip>` (D40) and the rest as text — the graph list, the
// inbox and the suggestions. The full label stays the tooltip.
import { CodeChip } from "@/kernel/ui/tags";
import { cn } from "@/lib/utils";
import { splitLabelKey } from "../label-key";
import type { LinkableType } from "../types";

export function EntityLabel({
  type,
  label,
  className,
}: {
  type: LinkableType;
  label: string;
  className?: string;
}) {
  const { key, rest } = splitLabelKey(type, label);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={label}>
      {key && <CodeChip>{key}</CodeChip>}
      {rest && <span className="min-w-0 truncate">{rest}</span>}
    </span>
  );
}
