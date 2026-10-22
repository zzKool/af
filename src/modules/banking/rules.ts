// Categorisation rules (specs/banking/spec.md US2, harvest H4): a text match on the bank row → BAS category /
// partner / "no document needed" on the journal entry. Pure matching (`orderRules`, `matchRule`, `firstHit`)
// + the service (CRUD, test, apply with dry run, learn from a transaction). Rules run on every import on the
// new rows and on demand; they never set a status, never create a link, never touch a hand-categorised entry.
// MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import type { CategorisationRule } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { basCode, uuid } from "@/kernel/validation/scalars";
import * as journal from "@/modules/journal";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import type {
  ApplyRulesResult,
  CategorisationRuleDto,
  RuleMatchField,
  RuleMatchType,
  RuleSource,
  RuleTestResult,
  RuleText,
} from "./types";
import { RULE_MATCH_FIELDS, RULE_MATCH_TYPES } from "./types";

const violation = (message: string, details?: Record<string, string | number>): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message,
  retryable: false,
  ...(details ? { details } : {}),
});
const invalid = (message: string): AppError => ({
  code: "VALIDATION_ERROR",
  message,
  retryable: false,
});
const notFound = (what: string, id: string): AppError => ({
  code: "NOT_FOUND",
  message: `${what} not found: ${id}`,
  retryable: false,
});

// --- pure matching ---

export type RuleLike = {
  id: string;
  matchType: RuleMatchType;
  matchPattern: string;
  matchField: RuleMatchField;
  priority: number;
  createdAt: Date;
  isActive?: boolean;
};

/** Active rules, priority desc → longer pattern first → newest first (deterministic tie-break, R56). */
export function orderRules<R extends RuleLike>(rules: readonly R[]): R[] {
  return rules
    .filter((r) => r.isActive !== false)
    .slice()
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.matchPattern.length - a.matchPattern.length ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
}

/** The text a rule looks at: one column, or the five text columns joined (`all`). Empty text never matches. */
export function fieldText(text: RuleText, field: RuleMatchField): string {
  switch (field) {
    case "counterparty_key":
      return text.counterpartyKey ?? "";
    case "name":
      return text.name ?? "";
    case "details":
      return text.additionalDetails ?? "";
    case "message":
      return text.message ?? "";
    case "sender":
      return text.sender ?? "";
    case "recipient":
      return text.recipient ?? "";
    case "all":
      return [text.name, text.additionalDetails, text.message, text.sender, text.recipient]
        .filter((v): v is string => !!v && v.trim() !== "")
        .join(" ");
  }
}

/** Case-insensitive; an invalid regex never matches and never throws. */
export function matchRule(
  rule: Pick<RuleLike, "matchType" | "matchPattern" | "matchField">,
  text: RuleText,
): boolean {
  const haystack = fieldText(text, rule.matchField).trim();
  if (haystack === "") return false;
  const pattern = rule.matchPattern.trim();
  if (pattern === "") return false;
  const h = haystack.toLowerCase();
  const p = pattern.toLowerCase();
  switch (rule.matchType) {
    case "exact":
      return h === p;
    case "starts_with":
      return h.startsWith(p);
    case "ends_with":
      return h.endsWith(p);
    case "contains":
      return h.includes(p);
    case "regex":
      try {
        return new RegExp(pattern, "i").test(haystack);
      } catch {
        return false;
      }
  }
}

/** The first rule (in `orderRules` order) that matches, or null. */
export function firstHit<R extends RuleLike>(ordered: readonly R[], text: RuleText): R | null {
  for (const r of ordered) if (matchRule(r, text)) return r;
  return null;
}

export function regexError(pattern: string): string | null {
  try {
    new RegExp(pattern, "i");
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid regular expression";
  }
}

// --- Zod schemas (the boundary) ---

export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    description: z.string().trim().max(500).nullable().optional(),
    matchType: z.enum(RULE_MATCH_TYPES as [RuleMatchType, ...RuleMatchType[]]),
    matchPattern: z.string().trim().min(1, "Pattern is required").max(500),
    matchField: z
      .enum(RULE_MATCH_FIELDS as [RuleMatchField, ...RuleMatchField[]])
      .default("counterparty_key"),
    basCode: basCode.nullable().optional(),
    partnerId: uuid.nullable().optional(),
    noDocumentNeeded: z.boolean().default(false),
    priority: z.number().int().min(0).max(999).default(100),
    isActive: z.boolean().default(true),
  })
  .refine((r) => r.basCode || r.partnerId || r.noDocumentNeeded, {
    message: "A rule must set a category, a partner or 'no document needed'",
  })
  .refine((r) => r.matchType !== "regex" || regexError(r.matchPattern) === null, {
    message: "Invalid regular expression",
  });

export const updateRuleSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  matchType: z.enum(RULE_MATCH_TYPES as [RuleMatchType, ...RuleMatchType[]]).optional(),
  matchPattern: z.string().trim().min(1).max(500).optional(),
  matchField: z.enum(RULE_MATCH_FIELDS as [RuleMatchField, ...RuleMatchField[]]).optional(),
  basCode: basCode.nullable().optional(),
  partnerId: uuid.nullable().optional(),
  noDocumentNeeded: z.boolean().optional(),
  priority: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

export const testRuleSchema = z.object({
  matchType: z.enum(RULE_MATCH_TYPES as [RuleMatchType, ...RuleMatchType[]]),
  matchPattern: z.string().trim().min(1).max(500),
  matchField: z.enum(RULE_MATCH_FIELDS as [RuleMatchField, ...RuleMatchField[]]),
});

export type RuleInput = z.input<typeof ruleInputSchema>;
export type UpdateRuleInput = z.input<typeof updateRuleSchema>;

// --- DTO mapping ---

export function toRuleDto(row: CategorisationRule): CategorisationRuleDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    matchType: row.matchType as RuleMatchType,
    matchPattern: row.matchPattern,
    matchField: row.matchField as RuleMatchField,
    basCode: row.basCode,
    partnerId: row.partnerId,
    noDocumentNeeded: row.noDocumentNeeded,
    priority: row.priority,
    isActive: row.isActive,
    ruleSource: row.ruleSource as RuleSource,
    hitCount: row.hitCount,
    lastHitAt: row.lastHitAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    source: row.source,
  };
}

function parseError(e: z.ZodError): AppError {
  return invalid(e.issues[0]?.message ?? "Invalid input");
}

async function validateTargets(
  tx: TransactionClient,
  input: { basCode?: string | null; partnerId?: string | null },
): Promise<AppError | null> {
  if (input.basCode) {
    const cat = await settings.getBasCategory(tx, input.basCode);
    if (!cat) return notFound("BAS category", input.basCode);
  }
  if (input.partnerId) {
    const p = await partners.getPartner(tx, input.partnerId);
    if (!p.data) return notFound("Partner", input.partnerId);
  }
  return null;
}

const duplicateName = (name: string): AppError => ({
  code: "DUPLICATE_ENTRY",
  message: `A rule named "${name}" exists`,
  retryable: false,
});

function isUniqueError(e: unknown): boolean {
  return !!e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002";
}

// --- CRUD ---

export async function createRule(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: RuleInput,
  ruleSource: RuleSource = "manual",
): Promise<ServiceResult<CategorisationRuleDto>> {
  const parsed = ruleInputSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const r = parsed.data;
  const err = await validateTargets(tx, r);
  if (err) return { error: err };
  // pre-checked: a unique violation would abort the surrounding Postgres transaction
  if (await tx.categorisationRule.findFirst({ where: { name: r.name }, select: { id: true } }))
    return { error: duplicateName(r.name) };
  try {
    const row = await tx.categorisationRule.create({
      data: {
        tenantId: caller.tenantId,
        name: r.name,
        description: r.description ?? null,
        matchType: r.matchType,
        matchPattern: r.matchPattern,
        matchField: r.matchField,
        basCode: r.basCode ?? null,
        partnerId: r.partnerId ?? null,
        noDocumentNeeded: r.noDocumentNeeded,
        priority: r.priority,
        isActive: r.isActive,
        ruleSource,
        createdBy: caller.userId,
        source: caller.source,
      },
    });
    await audit.log({
      action: "create",
      entityType: "categorisation_rule",
      entityId: row.id,
      newData: toAuditData(row),
    });
    return { data: toRuleDto(row) };
  } catch (e) {
    if (isUniqueError(e))
      return {
        error: {
          code: "DUPLICATE_ENTRY",
          message: `A rule named "${r.name}" exists`,
          retryable: false,
        },
      };
    throw e;
  }
}

export async function updateRule(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: UpdateRuleInput,
): Promise<ServiceResult<CategorisationRuleDto>> {
  const parsed = updateRuleSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  const { id, ...patch } = parsed.data;
  const existing = await tx.categorisationRule.findUnique({ where: { id } });
  if (!existing) return { error: notFound("Rule", id) };
  const merged = { ...toRuleDto(existing), ...stripUndefined(patch) };
  if (!(merged.basCode || merged.partnerId || merged.noDocumentNeeded))
    return { error: invalid("A rule must set a category, a partner or 'no document needed'") };
  if (merged.matchType === "regex") {
    const re = regexError(merged.matchPattern);
    if (re) return { error: invalid(`Invalid regular expression: ${re}`) };
  }
  const err = await validateTargets(tx, patch);
  if (err) return { error: err };
  if (
    patch.name &&
    patch.name !== existing.name &&
    (await tx.categorisationRule.findFirst({ where: { name: patch.name }, select: { id: true } }))
  )
    return { error: duplicateName(patch.name) };
  try {
    const row = await tx.categorisationRule.update({ where: { id }, data: stripUndefined(patch) });
    await audit.log({
      action: "update",
      entityType: "categorisation_rule",
      entityId: id,
      oldData: toAuditData(existing),
      newData: toAuditData(row),
    });
    void caller;
    return { data: toRuleDto(row) };
  } catch (e) {
    if (isUniqueError(e))
      return {
        error: {
          code: "DUPLICATE_ENTRY",
          message: `A rule named "${patch.name}" exists`,
          retryable: false,
        },
      };
    throw e;
  }
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export async function deleteRule(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  id: string,
): Promise<ServiceResult<{ id: string }>> {
  const existing = await tx.categorisationRule.findUnique({ where: { id } });
  if (!existing) return { error: notFound("Rule", id) };
  await tx.categorisationRule.delete({ where: { id } });
  await audit.log({
    action: "delete",
    entityType: "categorisation_rule",
    entityId: id,
    oldData: toAuditData(existing),
  });
  void caller;
  return { data: { id } };
}

export async function listRules(tx: TransactionClient): Promise<CategorisationRuleDto[]> {
  const rows = await tx.categorisationRule.findMany({
    orderBy: [{ priority: "desc" }, { name: "asc" }],
  });
  return rows.map(toRuleDto);
}

// --- applying ---

export type EntryTarget = {
  /** the journal entry to categorise */
  entryId: string;
  transactionId: string;
  description: string;
  text: RuleText;
};

/**
 * Run the ordered rules over entries and write the hits through the journal (which refuses to overwrite
 * hand-set facts). Returns the hits; `dryRun` writes nothing.
 */
export async function applyToEntries(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  rules: readonly CategorisationRule[],
  targets: readonly EntryTarget[],
  options: { dryRun?: boolean } = {},
): Promise<ServiceResult<ApplyRulesResult>> {
  const ordered = orderRules(rules);
  const preview: ApplyRulesResult["preview"] = [];
  const hitsByRule = new Map<string, number>();
  for (const t of targets) {
    const hit = firstHit(ordered, t.text);
    if (!hit) continue;
    preview.push({
      transactionId: t.transactionId,
      description: t.description,
      ruleName: hit.name,
      basCode: hit.basCode,
    });
    if (options.dryRun) continue;
    // a partner set by the rule with no category → the partner's default category (journal applies the never-overwrite rules)
    let basCode = hit.basCode;
    if (!basCode && hit.partnerId) {
      const p = await partners.getPartner(tx, hit.partnerId);
      basCode = p.data?.defaultBasCategoryCode ?? null;
    }
    const r = await journal.categorise(
      tx,
      caller,
      audit,
      t.entryId,
      { basCode, partnerId: hit.partnerId, noDocumentNeeded: hit.noDocumentNeeded },
      { by: "rule", ruleId: hit.id },
    );
    if (r.error) return { error: r.error };
    hitsByRule.set(hit.id, (hitsByRule.get(hit.id) ?? 0) + 1);
  }
  if (!options.dryRun) {
    const now = new Date();
    for (const [ruleId, n] of hitsByRule) {
      await tx.categorisationRule.update({
        where: { id: ruleId },
        data: { hitCount: { increment: n }, lastHitAt: now },
      });
    }
  }
  return {
    data: {
      dryRun: !!options.dryRun,
      tested: targets.length,
      applied: options.dryRun ? 0 : preview.length,
      preview: preview.slice(0, 50),
    },
  };
}

/** The tenant's uncategorised bank entries with their transaction text (the candidates of an on-demand apply). */
export async function uncategorisedTargets(
  tx: TransactionClient,
  limit = 20_000,
): Promise<EntryTarget[]> {
  const entries = await tx.journalEntry.findMany({
    where: { sourceType: "bank_transaction", categorisedBy: null },
    select: { id: true, sourceId: true },
    orderBy: { entryDate: "desc" },
    take: limit,
  });
  const ids = entries.flatMap((e) => (e.sourceId ? [e.sourceId] : []));
  const txs = await tx.bankTransaction.findMany({ where: { id: { in: ids } } });
  const byId = new Map(txs.map((t) => [t.id, t]));
  const targets: EntryTarget[] = [];
  for (const e of entries) {
    const t = e.sourceId ? byId.get(e.sourceId) : undefined;
    if (!t) continue;
    targets.push({
      entryId: e.id,
      transactionId: t.id,
      description: t.description,
      text: {
        counterpartyKey: t.counterpartyKey,
        name: t.name,
        additionalDetails: t.additionalDetails,
        message: t.message,
        sender: t.sender,
        recipient: t.recipient,
      },
    });
  }
  return targets;
}

/** On demand: every active rule over every uncategorised bank entry; dry run previews ≤ 50 and writes nothing. */
export async function applyRules(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  options: { dryRun?: boolean } = {},
): Promise<ServiceResult<ApplyRulesResult>> {
  const rules = await tx.categorisationRule.findMany({ where: { isActive: true } });
  const targets = await uncategorisedTargets(tx);
  return applyToEntries(tx, caller, audit, rules, targets, options);
}

/** How many of the newest uncategorised transactions a pattern would hit (the dialog's "Test"). */
export async function testRule(
  tx: TransactionClient,
  input: z.input<typeof testRuleSchema>,
): Promise<ServiceResult<RuleTestResult>> {
  const parsed = testRuleSchema.safeParse(input);
  if (!parsed.success) return { error: parseError(parsed.error) };
  if (parsed.data.matchType === "regex") {
    const re = regexError(parsed.data.matchPattern);
    if (re) return { error: invalid(`Invalid regular expression: ${re}`) };
  }
  const targets = await uncategorisedTargets(tx, 500);
  const hits = targets.filter((t) => matchRule(parsed.data, t.text));
  return {
    data: {
      matches: hits.length,
      tested: targets.length,
      sample: hits.slice(0, 5).map((h) => h.description),
    },
  };
}

/**
 * "Create rule from this transaction": pre-filled from the counterparty key and the entry's current facts,
 * source `learned`; the new rule is applied to that transaction at once.
 */
export async function createRuleFromTransaction(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  input: { transactionId: string } & Partial<RuleInput>,
): Promise<ServiceResult<CategorisationRuleDto>> {
  const t = await tx.bankTransaction.findUnique({ where: { id: input.transactionId } });
  if (!t) return { error: notFound("Bank transaction", input.transactionId) };
  const entries = await journal.entriesForSources(tx, "bank_transaction", [t.id]);
  const entry = entries.get(t.id);
  const ruleInput: RuleInput = {
    name: input.name ?? t.counterpartyKey,
    description: input.description ?? null,
    matchType: input.matchType ?? "contains",
    matchPattern: input.matchPattern ?? t.counterpartyKey,
    matchField: input.matchField ?? "counterparty_key",
    basCode: input.basCode !== undefined ? input.basCode : (entry?.basCode ?? null),
    partnerId: input.partnerId !== undefined ? input.partnerId : (entry?.partnerId ?? null),
    noDocumentNeeded: input.noDocumentNeeded ?? entry?.noDocumentNeeded ?? false,
    priority: input.priority ?? 100,
    isActive: true,
  };
  const created = await createRule(tx, caller, audit, ruleInput, "learned");
  if (created.error) return created;
  if (entry) {
    const row = await tx.categorisationRule.findUnique({ where: { id: created.data.id } });
    if (row) {
      const applied = await applyToEntries(
        tx,
        caller,
        audit,
        [row],
        [
          {
            entryId: entry.id,
            transactionId: t.id,
            description: t.description,
            text: {
              counterpartyKey: t.counterpartyKey,
              name: t.name,
              additionalDetails: t.additionalDetails,
              message: t.message,
              sender: t.sender,
              recipient: t.recipient,
            },
          },
        ],
      );
      if (applied.error) return { error: applied.error };
    }
  }
  return created;
}

/** The two universal rules, created on a tenant's first import when it has none (spec US2-8). */
export const DEFAULT_RULES: RuleInput[] = [
  {
    name: "Nordea bank fees",
    description: "AVGIFTER NORDEA — the statement is the proof",
    matchType: "contains",
    matchPattern: "AVGIFTER NORDEA",
    matchField: "counterparty_key",
    basCode: "657",
    noDocumentNeeded: true,
    priority: 100,
    isActive: true,
  },
  {
    name: "Savings interest",
    description: "Ränta / Interest — the yearly interest row of the savings account",
    matchType: "regex",
    matchPattern: "^(R[äa]nta|Interest)\\b",
    matchField: "details",
    basCode: "831",
    noDocumentNeeded: true,
    priority: 90,
    isActive: true,
  },
];

export async function ensureDefaultRules(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
): Promise<ServiceResult<{ created: number }>> {
  const n = await tx.categorisationRule.count();
  if (n > 0) return { data: { created: 0 } };
  let created = 0;
  for (const r of DEFAULT_RULES) {
    const cat = await settings.getBasCategory(tx, r.basCode ?? "");
    const res = await createRule(tx, caller, audit, cat ? r : { ...r, basCode: null }, "manual");
    if (res.error) return { error: res.error };
    created++;
  }
  return { data: { created } };
}

export { violation as ruleViolation };
