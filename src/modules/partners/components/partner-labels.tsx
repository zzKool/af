"use client";

// A partner's state and types on screen (D40): the state through the module's one family map (icon + word), the
// types as grey <Tag>s — metadata, never a colour. Used by the list, the partner page's title row and About.
import { useT } from "@/kernel/i18n/use-t";
import { StateLabel } from "@/kernel/ui/state-label";
import { Tag } from "@/kernel/ui/tags";
import { partnerState, partnerStateFamily } from "../state-family";
import { isSystemRole, PARTNER_TYPES, type PartnerType, SYSTEM_ROLES } from "../types";

export { isSystemRole, PARTNER_TYPES, SYSTEM_ROLES };

export function isPartnerType(value: string): value is PartnerType {
  return (PARTNER_TYPES as readonly string[]).includes(value);
}

export function PartnerStateLabel({ isActive }: { isActive: boolean }) {
  const t = useT();
  const state = partnerState(isActive);
  return (
    <span data-testid="partner-state" data-partner-state={state} className="inline-flex">
      <StateLabel family={partnerStateFamily(state)} state={t(`partners.status.${state}`)} />
    </span>
  );
}

export function PartnerTypeTags({
  types,
  systemRole = null,
}: {
  types: readonly string[];
  /** F129: the role a seeded partner plays — a grey tag beside the types, never a field */
  systemRole?: string | null;
}) {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap gap-1">
      {types.filter(isPartnerType).map((type) => (
        <Tag key={type}>{t(`partners.type.${type}`)}</Tag>
      ))}
      {isSystemRole(systemRole) && (
        <span data-testid="partner-role" data-partner-role={systemRole} className="inline-flex">
          <Tag>{t(`partners.role.${systemRole}`)}</Tag>
        </span>
      )}
    </span>
  );
}
