"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/kernel/auth/auth-client";
import { CompanyAvatar } from "@/kernel/ui/company-avatar";

type TenantInfo = { id: string; name: string };

export function TenantSwitcher({
  tenants,
  onSwitching,
}: {
  tenants: TenantInfo[];
  onSwitching?: (switching: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState(false);

  // Active org ID from BA session (reactive — updates immediately on switch)
  const session = authClient.useSession();
  const activeId = session.data?.session?.activeOrganizationId;
  // Tenant names come from Tenant model (source of truth for business data), passed as prop
  const activeTenant = tenants.find((t) => t.id === activeId) ?? tenants[0] ?? null;

  async function handleSwitch(tenant: TenantInfo) {
    if (tenant.id === activeTenant?.id || switching) return;
    setSwitching(true);
    onSwitching?.(true);
    try {
      await authClient.organization.setActive({ organizationId: tenant.id });
      // TODO: Reset Zustand stores on tenant switch (Story 2.5+)
      queryClient.clear();
      router.refresh();
    } finally {
      setSwitching(false);
      onSwitching?.(false);
    }
  }

  if (!activeTenant) {
    return (
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  // Single tenant — display only, no dropdown
  if (tenants.length <= 1) {
    return (
      <div className="flex items-center gap-3 px-3 py-2">
        <CompanyAvatar name={activeTenant.name} />
        <span className="truncate text-sm font-medium">{activeTenant.name}</span>
      </div>
    );
  }

  // Multi-tenant — dropdown switcher
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Current company: ${activeTenant.name}. Switch company.`}
        disabled={switching}
      >
        {switching ? (
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        ) : (
          <CompanyAvatar name={activeTenant.name} />
        )}
        <span className="flex-1 truncate text-sm font-medium">{activeTenant.name}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
        {tenants.map((tenant) => (
          <DropdownMenuItem
            key={tenant.id}
            onSelect={() => handleSwitch(tenant)}
            className="flex items-center gap-3"
          >
            <CompanyAvatar name={tenant.name} className="h-8 w-8 text-xs" />
            <span className="truncate">{tenant.name}</span>
            {tenant.id === activeTenant.id && (
              <span className="ml-auto text-xs text-muted-foreground">Active</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
