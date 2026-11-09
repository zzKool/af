"use client";

// The split primary (D40 title row): the main action, and its variants behind ▾ — `Import CSV ▾`.
// One per title row; the variants are links or actions of the same kind as the main one.
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type SplitButtonItem = { label: ReactNode; onClick: () => void; disabled?: boolean };

export function SplitButton({
  children,
  onClick,
  items,
  menuLabel,
  disabled,
  variant = "default",
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  items: SplitButtonItem[];
  /** aria-label of the ▾ half */
  menuLabel: string;
  disabled?: boolean;
  /** "outline" when another button of the row is the primary for now (F169: *Download and mark as sent*) */
  variant?: "default" | "outline";
  className?: string;
}) {
  return (
    <div className={cn("inline-flex", className)}>
      <Button onClick={onClick} disabled={disabled} variant={variant} className="rounded-r-none">
        {children}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={menuLabel}
              disabled={disabled}
              variant={variant}
              className={cn(
                "rounded-l-none px-1.5",
                variant === "default" ? "border-l border-l-primary-foreground/30" : "border-l-0",
              )}
            />
          }
        >
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          {items.map((item, i) => (
            <DropdownMenuItem
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, labels may be nodes
              key={i}
              disabled={item.disabled}
              onClick={item.onClick}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
