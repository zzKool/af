import { headers } from "next/headers";
import { ActionItemsWidget } from "@/components/domain/action-items-widget";
import { BusinessPulseWidget } from "@/components/domain/business-pulse-widget";
import { formatDateTime } from "@/lib/format-date";
import { resolveLocale } from "@/lib/locale";
import { getDashboardData } from "@/server/actions/dashboard";
import type { BusinessPulseMetric, DashboardActionItem } from "@/types/dashboard";

export default async function DashboardPage() {
  const hdrs = await headers();
  const locale = resolveLocale(hdrs.get("accept-language"));
  const result = await getDashboardData({});

  const data = result?.data;
  const userName = data?.userName ?? "User";
  const companyName = data?.companyName;
  const lastLoginAt = data?.lastLoginAt;

  // Empty for now — populated in Epic 8
  const actionItems: DashboardActionItem[] = [];
  const pulseMetrics: BusinessPulseMetric[] = [
    { id: "partners", label: "Active Partners", value: String(data?.partnerCount ?? 0) },
    { id: "contracts", label: "Active Contracts", value: String(data?.activeContractCount ?? 0) },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Compact welcome header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Welcome back, {userName}</h1>
        {companyName && <p className="text-muted-foreground">{companyName}</p>}
        {lastLoginAt && (
          <p className="text-sm text-muted-foreground">
            Last login: {formatDateTime(lastLoginAt, locale)}
          </p>
        )}
        {!lastLoginAt && data && <p className="text-sm text-muted-foreground">First login</p>}
      </div>

      {/* Two-column grid: Action Items first, Business Pulse second */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ActionItemsWidget items={actionItems} />
        <BusinessPulseWidget metrics={pulseMetrics} />
      </div>
    </div>
  );
}
