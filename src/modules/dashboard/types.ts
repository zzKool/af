export type DashboardActionItem = {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  href: string;
};

export type BusinessPulseMetric = {
  id: string;
  label: string;
  value: string;
  trend?: "up" | "down" | "neutral";
};
