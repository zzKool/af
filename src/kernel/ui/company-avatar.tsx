"use client";

import { cn } from "@/lib/utils";

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function CompanyAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground",
        className,
      )}
      aria-hidden="true"
    >
      {getInitials(name) || "?"}
    </div>
  );
}

/** The entity page's tile (D76, the board *Partner*): the initial, 64 px, 18 px corners, the primary's tint. */
export function EntityTile({ name, className }: { name: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex size-16 shrink-0 items-center justify-center rounded-[18px] bg-linear-135 from-primary to-primary/70 text-[26px] font-bold text-primary-foreground",
        className,
      )}
      aria-hidden="true"
      data-testid="entity-tile"
    >
      {getInitials(name).slice(0, 1) || "?"}
    </div>
  );
}
