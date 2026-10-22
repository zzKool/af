"use client";

// The docked details panel's building blocks (D40): collapsible sections with a chevron header —
// About this <thing> · Proof · the module's form · History (collapsed by default) — and the About grid
// (label column 110 px, muted). Small (26 px, `size="sm"`) buttons inside.
import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/utils";

export function DetailsSection({
  title,
  defaultOpen = true,
  children,
  className,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={cn("border-t border-subtle pt-2", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 py-1 text-left text-[13px] font-semibold hover:text-primary-hover"
      >
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
        {title}
      </button>
      <div id={id} hidden={!open} className="pt-1 pb-2">
        {children}
      </div>
    </section>
  );
}

/** Key–value rows of an About section: `[label, value]`; an empty value shows a dash. */
export function DetailsGrid({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
      {rows.map(([label, value], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and static per render
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">
            {value ?? <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
