// One section of Settings as a card (F157, the Pulse-Settings board): the section's title (h2 — the page's h1 is
// *Settings*, in the layout), one line under it, its actions right, its tabs, then the content. Server-friendly.
import type { ReactNode } from "react";

export function SettingsSection({
  title,
  meta,
  actions,
  tabs,
  children,
  testId,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="pulse-card flex min-w-0 flex-col gap-4 p-5" data-testid={testId}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-[14rem] flex-1">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {meta && <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {tabs}
      <div className="min-w-0">{children}</div>
    </section>
  );
}
