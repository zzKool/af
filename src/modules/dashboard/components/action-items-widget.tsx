import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardActionItem } from "@/modules/dashboard/types";

export function ActionItemsWidget({ items }: { items: DashboardActionItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Action Items</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground">
            No pending items — action items will appear here as you import bank statements and
            documents
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>{item.title}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
