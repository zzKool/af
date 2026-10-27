// Categorisation rules (specs/banking/spec.md US2, harvest H4): a text match on the bank row → BAS category /
// partner / "no document needed" on the row itself (F113). Pure matching (`orderRules`, `matchRule`, `firstHit`)
// + the service (CRUD, test, apply with dry run, learn from a transaction). Rules run on every import on the
// new rows and on demand; they never set a status, never create a link, never touch a hand-categorised row.
// MUST NOT import from next/* or src/components/*.
import { z } from "zod/v4";
import type { CategorisationRule } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { toAuditData } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import { MATCH_TOLERANCE_PCT } from "@/kernel/money/settlement";
import { basCode, uuid } from "@/kernel/validation/scalars";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { categorise, transactionFacts, uncategorisedTransactions } from "./facts";
import type {
  ApplyRulesResult,
  BankTransactionDto,
  CategorisationRuleDto,
  RuleCadence,
  RuleMatchField,
  RuleMatchType,
  RuleNearMiss,
  RuleNearMissReason,
  RuleSign,
  RuleSource,
  RuleTestResult,
  RuleText,
} from "./types";
import { RULE_CADENCES, RULE_MATCH_FIELDS, RULE_MATCH_TYPES, RULE_SIGNS } from "./types";

const D = Prisma.Decimal;

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
  /** F116 PR C1 — absent = no condition */
  bankAccountId?: string | null;
  sign?: RuleSign | string;
  expectedAmount?: { toString(): string } | string | null;
  tolerancePct?: { toString(): string } | string | null;
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
      return bankText(text);
  }
}

/**
 * Every text field Nordea gave — name, details, message, sender, recipient — the non-blank ones joined by a space:
 * the rule field `all` and the transfer-pair hints read the same text (lessons audit 32).
 */
export function bankText(
  text: Pick<RuleText, "name" | "additionalDetails" | "message" | "sender" | "recipient">,
): string {
  return [text.name, text.additionalDetails, text.message, text.sender, text.recipient]
    .filter((v): v is string => !!v && v.trim() !== "")
    .join(" ");
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

/**
 * The conditions beyond the text (F116 FR-007): the paying account, the sign, the expected |amount| ± tolerance %.
 * Null when they hold; else the first one that does not. A fact the caller does not know is not checked.
 */
export function conditionMiss(
  rule: Pick<RuleLike, "bankAccountId" | "sign" | "expectedAmount" | "tolerancePct">,
  text: Pick<RuleText, "bankAccountId" | "amount">,
): Exclude<RuleNearMissReason, "cadence"> | null {
  if (rule.bankAccountId && text.bankAccountId && rule.bankAccountId !== text.bankAccountId)
    return "account";
  if (text.amount != null && text.amount !== "") {
    const amount = new D(text.amount);
    if (rule.sign === "in" && amount.lte(0)) return "sign";
    if (rule.sign === "out" && amount.gte(0)) return "sign";
    if (rule.expectedAmount != null && String(rule.expectedAmount) !== "") {
      const expected = new D(String(rule.expectedAmount));
      const tolerance = expected
        .mul(new D(String(rule.tolerancePct ?? MATCH_TOLERANCE_PCT)))
        .div(100);
      if (amount.abs().minus(expected).abs().gt(tolerance)) return "amount";
    }
  }
  return null;
}

/** The first rule (in `orderRules` order) whose text matches and whose conditions hold, or null. */
export function firstHit<R extends RuleLike>(ordered: readonly R[], text: RuleText): R | null {
  for (const r of ordered) if (matchRule(r, text) && conditionMiss(r, text) === null) return r;
  return null;
}

/** When no rule hits: the first rule whose text matched but a condition did not — the *Needs a look* entry. */
export function firstNearMiss<R extends RuleLike>(
  ordered: readonly R[],
  text: RuleText,
): { rule: R; reason: Exclude<RuleNearMissReason, "cadence"> } | null {
  if (firstHit(ordered, text)) return null;
  for (const r of ordered) {
    if (!matchRule(r, text)) continue;
    const reason = conditionMiss(r, text);
    if (reason) return { rule: r, reason };
  }
  return null;
}

/** The days between two rows of a rule with a cadence that read as on time (a weekend, a short month, a holiday). */
export const CADENCE_DAYS: Record<Exclude<RuleCadence, "none">, readonly [number, number]> = {
  monthly: [20, 40],
  quarterly: [75, 105],
  yearly: [330, 400],
};

/**
 * The rows of one rule that came off its cadence (pure): booking dates, oldest first → the later row of every gap
 * outside the band. A flag, never a condition (D67's answer, as built): a year file of interest rows would
 * otherwise leave eleven of twelve uncategorised.
 */
export function offCadence(
  cadence: RuleCadence,
  rows: readonly { id: string; bookingDate: string }[],
): string[] {
  if (cadence === "none") return [];
  const [min, max] = CADENCE_DAYS[cadence];
  const sorted = [...rows].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  const out: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev || !cur) continue;
    const days =
      (Date.parse(`${cur.bookingDate}T00:00:00Z`) - Date.parse(`${prev.bookingDate}T00:00:00Z`)) /
      86_400_000;
    if (days < min || days > max) out.push(cur.id);
  }
  return out;
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
    bankAccountId: uuid.nullable().optional(),
    sign: z.enum(RULE_SIGNS as [RuleSign, ...RuleSign[]]).default("any"),
    expectedAmount: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, "An amount like 132.52")
      .nullable()
      .optional(),
    tolerancePct: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, "A percentage like 0.5")
      .refine((v) => Number(v) <= 50, "At most 50 %")
      .default(MATCH_TOLERANCE_PCT),
    cadence: z.enum(RULE_CADENCES as [RuleCadence, ...RuleCadence[]]).default("none"),
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
  bankAccountId: uuid.nullable().optional(),
  sign: z.enum(RULE_SIGNS as [RuleSign, ...RuleSign[]]).optional(),
  expectedAmount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "An amount like 132.52")
    .nullable()
    .optional(),
  tolerancePct: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "A percentage like 0.5")
    .refine((v) => Number(v) <= 50, "At most 50 %")
    .optional(),
  cadence: z.enum(RULE_CADENCES as [RuleCadence, ...RuleCadence[]]).optional(),
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
    bankAccountId: row.bankAccountId,
    sign: row.sign as RuleSign,
    expectedAmount: row.expectedAmount ? row.expectedAmount.toFixed(2) : null,
    tolerancePct: row.tolerancePct.toFixed(2),
    cadence: row.cadence as RuleCadence,
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
  input: { basCode?: string | null; partnerId?: string | null; bankAccountId?: string | null },
): Promise<AppError | null> {
  if (input.basCode) {
    const cat = await settings.getBasCategory(tx, input.basCode);
    if (!cat) return notFound("BAS category", input.basCode);
  }
  if (input.partnerId) {
    const p = await partners.getPartner(tx, input.partnerId);
    if (!p.data) return notFound("Partner", input.partnerId);
  }
  if (input.bankAccountId) {
    const a = await tx.bankAccount.findUnique({
      where: { id: input.bankAccountId },
      select: { bankFormatId: true },
    });
    if (!a) return notFound("Bank account", input.bankAccountId);
    if (!a.bankFormatId)
      return invalid("A private instrument has no rows — a rule cannot match it");
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
        bankAccountId: r.bankAccountId ?? null,
        sign: r.sign,
        expectedAmount: r.expectedAmount ?? null,
        tolerancePct: r.tolerancePct,
        cadence: r.cadence,
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

/** A row the rules run over: its id and the text they match. */
export type RuleTarget = {
  transactionId: string;
  description: string;
  text: RuleText;
};

type RuleFacts = Pick<
  BankTransactionDto,
  "basCode" | "partnerId" | "noDocumentNeeded" | "categorisedBy" | "ruleId"
>;

/** True when the categorisation wrote something on the row — any of the facts a rule may set, or who set them. */
export function changedBy(before: RuleFacts | undefined, after: RuleFacts): boolean {
  if (!before) return true;
  return (
    before.basCode !== after.basCode ||
    before.partnerId !== after.partnerId ||
    before.noDocumentNeeded !== after.noDocumentNeeded ||
    before.categorisedBy !== after.categorisedBy ||
    before.ruleId !== after.ruleId
  );
}

/**
 * Run the ordered rules over rows and write the hits through `categorise` (which refuses to overwrite hand-set
 * facts). Returns the hits; `dryRun` writes nothing.
 */
export async function applyToTransactions(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  rules: readonly CategorisationRule[],
  targets: readonly RuleTarget[],
  options: { dryRun?: boolean } = {},
): Promise<ServiceResult<ApplyRulesResult>> {
  const ordered = orderRules(rules);
  const preview: ApplyRulesResult["preview"] = [];
  const hitsByRule = new Map<string, number>();
  // the rows as they were: a hit that changes nothing (the never-overwrite rules) is not counted
  const before = options.dryRun
    ? new Map<string, BankTransactionDto>()
    : await transactionFacts(
        tx,
        targets.map((t) => t.transactionId),
      );
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
    // a partner set by the rule with no category → the partner's default category (`categorise` applies the never-overwrite rules)
    let basCode = hit.basCode;
    if (!basCode && hit.partnerId) {
      const p = await partners.getPartner(tx, hit.partnerId);
      basCode = p.data?.defaultBasCategoryCode ?? null;
    }
    const r = await categorise(
      tx,
      caller,
      audit,
      t.transactionId,
      { basCode, partnerId: hit.partnerId, noDocumentNeeded: hit.noDocumentNeeded },
      { by: "rule", ruleId: hit.id },
    );
    if (r.error) return { error: r.error };
    if (changedBy(before.get(t.transactionId), r.data))
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

/** The text of a row a rule looks at. */
export function ruleTarget(t: {
  id: string;
  description: string;
  counterpartyKey: string;
  name: string | null;
  additionalDetails: string | null;
  message: string | null;
  sender: string | null;
  recipient: string | null;
  bankAccountId?: string;
  amount?: { toFixed(n: number): string } | string;
}): RuleTarget {
  return {
    transactionId: t.id,
    description: t.description,
    text: {
      counterpartyKey: t.counterpartyKey,
      name: t.name,
      additionalDetails: t.additionalDetails,
      message: t.message,
      sender: t.sender,
      recipient: t.recipient,
      bankAccountId: t.bankAccountId ?? null,
      amount:
        t.amount === undefined
          ? null
          : typeof t.amount === "string"
            ? t.amount
            : t.amount.toFixed(2),
    },
  };
}

/** The tenant's uncategorised rows with their text (the candidates of an on-demand apply), newest first. */
export async function uncategorisedTargets(
  tx: TransactionClient,
  limit = 20_000,
): Promise<RuleTarget[]> {
  const rows = await uncategorisedTransactions(tx, limit);
  return rows.map(ruleTarget);
}

/** On demand: every active rule over every uncategorised row; dry run previews ≤ 50 and writes nothing. */
export async function applyRules(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  options: { dryRun?: boolean } = {},
): Promise<ServiceResult<ApplyRulesResult>> {
  const rules = await tx.categorisationRule.findMany({ where: { isActive: true } });
  const targets = await uncategorisedTargets(tx);
  return applyToTransactions(tx, caller, audit, rules, targets, options);
}

/**
 * The rules page's *Needs a look* (F116 FR-007): uncategorised rows whose text matched a rule but whose account,
 * sign or amount did not — the rule that almost fired and why; and rows a rule with a cadence categorised off its
 * rhythm. Newest first, capped.
 */
export async function ruleNearMisses(tx: TransactionClient, limit = 100): Promise<RuleNearMiss[]> {
  const rules = await tx.categorisationRule.findMany({ where: { isActive: true } });
  const ordered = orderRules(rules);
  const out: RuleNearMiss[] = [];
  const conditional = ordered.filter(
    (r) => r.bankAccountId || r.sign !== "any" || r.expectedAmount !== null,
  );
  if (conditional.length > 0) {
    for (const t of await uncategorisedTransactions(tx, 2_000)) {
      const near = firstNearMiss(ordered, ruleTarget(t).text);
      if (!near) continue;
      out.push({
        transactionId: t.id,
        bookingDate: t.bookingDate.toISOString().slice(0, 10),
        amount: t.amount.toFixed(2),
        currency: t.currency,
        description: t.description,
        ruleId: near.rule.id,
        ruleName: near.rule.name,
        reason: near.reason,
        expected:
          near.reason === "amount" && near.rule.expectedAmount
            ? `${near.rule.expectedAmount.toFixed(2)} ± ${near.rule.tolerancePct.toFixed(2)} %`
            : null,
      });
    }
  }
  for (const r of ordered.filter((x) => x.cadence !== "none")) {
    const rows = await tx.bankTransaction.findMany({
      where: { ruleId: r.id },
      select: { id: true, bookingDate: true, amount: true, currency: true, description: true },
      orderBy: { bookingDate: "asc" },
    });
    const late = new Set(
      offCadence(
        r.cadence as RuleCadence,
        rows.map((x) => ({ id: x.id, bookingDate: x.bookingDate.toISOString().slice(0, 10) })),
      ),
    );
    for (const x of rows.filter((y) => late.has(y.id))) {
      out.push({
        transactionId: x.id,
        bookingDate: x.bookingDate.toISOString().slice(0, 10),
        amount: x.amount.toFixed(2),
        currency: x.currency,
        description: x.description,
        ruleId: r.id,
        ruleName: r.name,
        reason: "cadence",
        expected: null,
      });
    }
  }
  return out
    .sort(
      (a, b) =>
        b.bookingDate.localeCompare(a.bookingDate) ||
        a.transactionId.localeCompare(b.transactionId),
    )
    .slice(0, limit);
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
 * "Create rule from this transaction": pre-filled from the counterparty key and the row's current facts,
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
  const ruleInput: RuleInput = {
    name: input.name ?? t.counterpartyKey,
    description: input.description ?? null,
    matchType: input.matchType ?? "contains",
    matchPattern: input.matchPattern ?? t.counterpartyKey,
    matchField: input.matchField ?? "counterparty_key",
    basCode: input.basCode !== undefined ? input.basCode : t.basCode,
    partnerId: input.partnerId !== undefined ? input.partnerId : t.partnerId,
    noDocumentNeeded: input.noDocumentNeeded ?? t.noDocumentNeeded,
    priority: input.priority ?? 100,
    isActive: true,
  };
  const created = await createRule(tx, caller, audit, ruleInput, "learned");
  if (created.error) return created;
  const row = await tx.categorisationRule.findUnique({ where: { id: created.data.id } });
  if (row) {
    const applied = await applyToTransactions(tx, caller, audit, [row], [ruleTarget(t)]);
    if (applied.error) return { error: applied.error };
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
