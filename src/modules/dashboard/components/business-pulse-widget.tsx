import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BusinessPulseMetric } from "@/modules/dashboard/types";

export function BusinessPulseWidget({ metrics }: { metrics: BusinessPulseMetric[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business Pulse</CardTitle>
      </CardHeader>
      <CardContent>
        {metrics.length === 0 ? (
          <p className="text-muted-foreground">
            Business overview will appear here as your financial data grows
          </p>
        ) : (
          <ul className="space-y-2">
            {metrics.map((metric) => (
              <li key={metric.id}>
                {metric.label}: {metric.value}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
