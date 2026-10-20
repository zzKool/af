import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { NavItem } from "@/kernel/nav/constants";

/** Filter nav items by enabled state and user role */
export function filterNavItems(items: readonly NavItem[], role: CallerIdentity["role"]): NavItem[] {
  return items.filter((item) => item.enabled && item.roles.includes(role));
}
