import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { requestLocale } from "@/kernel/i18n/request-locale";
import { translator } from "@/kernel/i18n/translate";
import { EntityPage } from "@/kernel/ui/shell/page";
import { Tag } from "@/kernel/ui/tags";
import {
  entityHref,
  GRAPH_DEFAULT_DEPTH,
  type LinkableType,
  listLinkableTypes,
  neighbourhood,
} from "@/modules/linking";
import { EntityLabel, LinkGraph } from "@/modules/linking/ui";
import { getUserPreferences } from "@/modules/settings";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The neighbourhood of one entity (specs/linking, the graph read model) — anyone who may read links.
export default async function LinkGraphPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ type, id }, sp] = await Promise.all([params, searchParams]);
  const auth = await requireCaller({ action: "read", subject: "link" });
  if (!listLinkableTypes().includes(type as LinkableType) || !UUID.test(id)) notFound();
  const depthParam = Number(typeof sp.depth === "string" ? sp.depth : GRAPH_DEFAULT_DEPTH);
  const depth = Number.isInteger(depthParam) ? depthParam : GRAPH_DEFAULT_DEPTH;

  const data = await withTenantTransaction(prisma, auth.tenantId, async (tx) => {
    const graph = await neighbourhood(tx, { type: type as LinkableType, id }, { depth });
    const prefs = await getUserPreferences(tx, auth);
    return { graph, prefs };
  });
  if (!data.graph) notFound();
  const t = translator(await requestLocale(data.prefs.data?.locale));
  const graph = data.graph;
  const root = graph.nodes.find((n) => n.key === graph.root);
  if (!root) notFound();
  const maxDepth = graph.nodes.reduce((m, n) => Math.max(m, n.depth), 0);

  return (
    <EntityPage
      title={
        <span className="flex min-w-0 items-center gap-2">
          {t("linking.graph.title")}
          <EntityLabel type={root.type} label={root.label} className="text-base font-normal" />
        </span>
      }
      tags={<Tag>{t(`linking.type.${root.type}`)}</Tag>}
      actions={
        <Button nativeButton={false} render={<Link href={entityHref(root)} />}>
          {t("linking.graph.openEntity")}
        </Button>
      }
      back={<Link href={entityHref(root)}>{t("linking.graph.back", { label: root.label })}</Link>}
      meta={t("linking.graph.meta", {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        depth: maxDepth,
      })}
    >
      <LinkGraph graph={graph} />
    </EntityPage>
  );
}
