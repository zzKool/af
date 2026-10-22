"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/kernel/i18n/use-t";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  return (
    <div className="p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("errors.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">{t("errors.load.dashboard")}</p>
          <Button onClick={reset}>{t("errors.tryAgain")}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
