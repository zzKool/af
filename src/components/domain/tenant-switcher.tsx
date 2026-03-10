"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CompanyAvatar } from "@/components/shared/company-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

export function TenantSwitcher({ onSwitching }: { onSwitching?: (switching: boolean) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState(false);

  const session = authClient.useSession();
  const orgList = authClient.useListOrganizations();

  const activeId = session.data?.session?.activeOrganizationId;
  const orgs = orgList.data ?? [];
  const activeOrg = orgs.find((o) => o.id === activeId) ?? orgs[0] ?? null;

  async function handleSwitch(org: { id: string; name: string }) {
    if (org.id === activeOrg?.id || switching) return;
    setSwitching(true);
    onSwitching?.(true);
    try {
      await authClient.organization.setActive({ organizationId: org.id });
      // TODO: Reset Zustand stores on tenant switch (Story 2.5+)
      queryClient.clear();
      router.refresh();
    } finally {
      setSwitching(false);
      onSwitching?.(false);
    }
  }

  if (orgList.isPending || !activeOrg) {
    return (
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  // Single tenant — display only, no dropdown
  if (orgs.length <= 1) {
    return (
      <div className="flex items-center gap-3 px-3 py-2">
        <CompanyAvatar name={activeOrg.name} />
        <span className="truncate text-sm font-medium">{activeOrg.name}</span>
      </div>
    );
  }

  // Multi-tenant — dropdown switcher
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Current company: ${activeOrg.name}. Switch company.`}
        disabled={switching}
      >
        {switching ? (
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        ) : (
          <CompanyAvatar name={activeOrg.name} />
        )}
        <span className="flex-1 truncate text-sm font-medium">{activeOrg.name}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onSelect={() => handleSwitch(org)}
            className="flex items-center gap-3"
          >
            <CompanyAvatar name={org.name} className="h-8 w-8 text-xs" />
            <span className="truncate">{org.name}</span>
            {org.id === activeOrg.id && (
              <span className="ml-auto text-xs text-muted-foreground">Active</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
