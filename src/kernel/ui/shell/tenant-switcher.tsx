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

  // compact, for the top bar (D40): the company's initials and name; a menu only with several companies
  if (!activeTenant) {
    return <div className="h-7 w-28 animate-pulse rounded-md bg-hover" />;
  }

  if (tenants.length <= 1) {
    return (
      <div className="flex h-8 max-w-56 items-center gap-2 px-2 text-[13px]">
        <CompanyAvatar name={activeTenant.name} className="size-5 rounded text-[10px]" />
        <span className="truncate">{activeTenant.name}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-8 max-w-56 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Current company: ${activeTenant.name}. Switch company.`}
        disabled={switching}
      >
        {switching ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <CompanyAvatar name={activeTenant.name} className="size-5 rounded text-[10px]" />
        )}
        <span className="truncate">{activeTenant.name}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {tenants.map((tenant) => (
          <DropdownMenuItem
            key={tenant.id}
            onClick={() => handleSwitch(tenant)}
            className="flex items-center gap-2"
          >
            <CompanyAvatar name={tenant.name} className="size-6 rounded text-[10px]" />
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
