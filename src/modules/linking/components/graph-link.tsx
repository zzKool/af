"use client";

// The "Graph" button next to an entity's links — opens the neighbourhood page of that entity.
import { Waypoints } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { cn } from "@/lib/utils";
import { graphHref } from "@/modules/linking/hrefs";
import type { LinkEndpoint } from "@/modules/linking/types";

export function GraphLink({ self, className }: { self: LinkEndpoint; className?: string }) {
  const t = useT();
  return (
    <Link
      href={graphHref(self)}
      className={cn(buttonVariants({ variant: "ghost", size: "xs" }), className)}
      data-testid="graph-link"
    >
      <Waypoints aria-hidden="true" />
      {t("linking.graph.open")}
    </Link>
  );
}
