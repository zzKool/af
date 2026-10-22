// Where a node of the graph takes you — plain functions, usable from server and client components alike.
import type { GraphNode, LinkEndpoint } from "./types";

/** The neighbourhood page of an entity. */
export const graphHref = (e: LinkEndpoint): string => `/links/${e.type}/${e.id}`;

/** The entity's own page, or its list with the panel open (`?open=`). */
export function entityHref(node: Pick<GraphNode, "type" | "id" | "label">): string {
  switch (node.type) {
    case "invoice":
      return `/invoices/${node.id}`;
    case "document":
      return `/documents/${node.id}`;
    case "partner":
      return `/partners/${node.id}`;
    case "settlement":
      return `/expenses/settlements/${node.id}`;
    case "expense":
      return `/expenses?open=${node.id}`;
    case "supplier_invoice":
      return `/supplier-invoices?open=${node.id}`;
    case "bank_transaction":
      return `/banking?open=${node.id}`;
    case "contract":
      return `/partners?q=${encodeURIComponent(node.label)}`;
    case "journal_entry":
      return "/journal";
  }
}

/** The panel that writes an entity's own payments (D37, F58), the bank row preselected (`&attach=`). */
export function attachHref(to: LinkEndpoint, bankTransactionId: string): string {
  const href = entityHref({ ...to, label: "" });
  return `${href}${href.includes("?") ? "&" : "?"}attach=${bankTransactionId}`;
}
