// Page archetypes (D19, ui-conventions): full width, dense, three shapes and nothing else.
//   <ListPage title actions>     DataTable pages — content stretches, no max-w
//   <EntityPage title meta tabs> header + tabs (overview, documents, links, audit)
//   <WorkPage left right>        split panes — list left, detail right
// Server-component friendly (no hooks). Prose-length limits belong to prose, never to containers.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Omit when the content carries its own header (an entity's tabs component, say). */
  title?: ReactNode;
  /** One line under the title: counts, status, period. */
  meta?: ReactNode;
  /** Primary actions, right-aligned. */
  actions?: ReactNode;
  /** Breadcrumb-ish parent link rendered above the title. */
  back?: ReactNode;
  className?: string;
}

export function PageHeader({ title, meta, actions, back, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        {back && <div className="mb-1 text-xs text-muted-foreground">{back}</div>}
        <h1 className="truncate text-xl font-semibold leading-tight">{title}</h1>
        {meta && <div className="mt-0.5 text-sm text-muted-foreground">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function ListPage({
  children,
  className,
  ...header
}: PageHeaderProps & { children: ReactNode }) {
  return (
    <div className={cn("flex min-h-full flex-col gap-4 p-4 md:p-6", className)}>
      <PageHeader {...header} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function EntityPage({
  children,
  className,
  ...header
}: PageHeaderProps & { children: ReactNode }) {
  return (
    <div className={cn("flex min-h-full flex-col gap-4 p-4 md:p-6", className)}>
      {header.title !== undefined && <PageHeader {...header} />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export interface WorkPageProps extends PageHeaderProps {
  left: ReactNode;
  right: ReactNode;
  /** CSS width of the left pane (default 24rem). */
  leftWidth?: string;
}

export function WorkPage({
  left,
  right,
  leftWidth = "24rem",
  className,
  ...header
}: WorkPageProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-4 p-4 md:p-6", className)}>
      <PageHeader {...header} />
      <div
        className="grid min-h-0 flex-1 gap-4"
        style={{ gridTemplateColumns: `${leftWidth} minmax(0, 1fr)` }}
      >
        <section className="min-h-0 overflow-auto rounded-md border" aria-label="List">
          {left}
        </section>
        <section className="min-h-0 overflow-auto" aria-label="Detail">
          {right}
        </section>
      </div>
    </div>
  );
}
