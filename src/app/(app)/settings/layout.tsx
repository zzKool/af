import type { ReactNode } from "react";
import { requireCaller } from "@/kernel/auth/caller";
import { Msg } from "@/kernel/i18n/msg";
import { ListPage } from "@/kernel/ui/shell/page";
import { SettingsMenu } from "@/modules/settings/ui";

// Settings (F157, the Pulse-Settings board): one page on the ground — the sub-menu left (You · Company ·
// Automation), the section's cards right. Each section page renders its own `SettingsSection` cards.
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const caller = await requireCaller();
  return (
    <ListPage ground title={<Msg k="settings.title" />}>
      <div className="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <SettingsMenu owner={caller.role === "owner"} />
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
      </div>
    </ListPage>
  );
}
