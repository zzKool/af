// Metadata, the D40 way — three small grey things, never a colour:
//   <Tag>        bank, currency, document type, VAT registration (12 px, 4 px radius, --tag)
//   <CodeChip>   a business key: VA26-INV-007, SI-2026-031, Ex12-6540-003_2026-07-28_ (mono)
//   <CountBadge> an open-work or tab count (round, 11 px / 600, --border-subtle)
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md bg-tag px-1.5 text-xs whitespace-nowrap text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function CodeChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        "inline-flex h-5 items-center rounded-md bg-tag px-1.5 font-mono text-xs whitespace-nowrap text-foreground",
        className,
      )}
    >
      {children}
    </code>
  );
}

export function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-subtle px-1.5 text-[11px] font-semibold text-muted-foreground tabular-nums",
        className,
      )}
    >
      {count}
    </span>
  );
}
