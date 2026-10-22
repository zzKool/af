// The info banner (D40 page anatomy 4): what the owner should do next on this page — one sentence, one link,
// at most one small button on the right. Not for errors (those are toasts or inline).
//   <InfoBanner action={<Button size="sm">Build</Button>}>
//     July 2026: 4 transactions have no proof yet — package 2026-07 not built. <Link href=…>Open package</Link>
//   </InfoBanner>
import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function InfoBanner({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-lg bg-tag px-3 py-1.5 text-[13px] [&_a]:text-primary [&_a:hover]:text-primary-hover [&_a:hover]:underline",
        className,
      )}
    >
      <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
