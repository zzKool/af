// A proposal's payload per kind (F98, specs/ai FR-003) — written from these types, parsed on read (lessons 29:
// a JSON column is never cast). `newPartner` is the model's (T013b): a company not among the partners yet, created
// on the owner's accept.
import { z } from "zod";

export const PROPOSAL_KINDS = ["bas", "partner"] as const;
export type ProposalKindName = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_SOURCES = ["rule", "partner_default", "memory", "model"] as const;
export type ProposalSourceName = (typeof PROPOSAL_SOURCES)[number];

const basCode = z.string().regex(/^\d{4}$/); // D68: four digits

export const basPayloadSchema = z.object({
  basCode,
  alternatives: z.array(z.object({ basCode, why: z.string().max(160) })).max(3),
});
export type BasPayload = z.infer<typeof basPayloadSchema>;

export const partnerPayloadSchema = z.union([
  z.object({ partnerId: z.string().uuid() }),
  z.object({
    newPartner: z.object({
      name: z.string().trim().min(1).max(200),
      type: z.enum(["supplier", "client", "authority", "other"]),
      country: z.string().length(2).optional(),
    }),
  }),
]);
export type PartnerPayload = z.infer<typeof partnerPayloadSchema>;

/**
 * The model was asked who a row's counterparty is and named nobody (T013b). Stored as the proposal's payload so
 * the row is not asked again on the same facts; it fits no payload schema on purpose — `parsePayload` returns null
 * and every read ignores it (never current, never shown, never accepted).
 */
export const NO_PARTNER_PAYLOAD = { none: true } as const;

/** A proposed new partner's kind → the partner type it is created with. */
export function newPartnerType(type: "supplier" | "client" | "authority" | "other") {
  return type === "client" ? "client" : type === "authority" ? "authority" : "vendor";
}

export type ParsedPayload =
  | { kind: "bas"; payload: BasPayload }
  | { kind: "partner"; payload: PartnerPayload };

/** The stored JSON → the typed payload, or null when it does not fit (an old shape: the proposal is ignored). */
export function parsePayload(kind: ProposalKindName, json: unknown): ParsedPayload | null {
  if (kind === "bas") {
    const p = basPayloadSchema.safeParse(json);
    return p.success ? { kind, payload: p.data } : null;
  }
  const p = partnerPayloadSchema.safeParse(json);
  return p.success ? { kind, payload: p.data } : null;
}
