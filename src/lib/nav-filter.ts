import type { CallerIdentity } from "@/types/caller-identity";
import type { NavItem } from "./constants";

/** Filter nav items by enabled state and user role */
export function filterNavItems(items: readonly NavItem[], role: CallerIdentity["role"]): NavItem[] {
  return items.filter((item) => item.enabled && item.roles.includes(role));
}
