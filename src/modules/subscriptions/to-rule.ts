// A subscription as a rule (F116 PR C2, specs/linking/one-engine.md FR-008, D67): the subscription's text,
// partner, category, paying account, direction, price ± tolerance and cadence become one categorisation rule —
// the one engine categorises its rows from then on. The subscription itself stays (its fate is F104's, 2026-11-30).
// MUST NOT import from next/* or src/components/*.
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { AppError, ServiceResult } from "@/kernel/errors/app-error";
import * as banking from "@/modules/banking";

const violation = (message: string): AppError => ({
  code: "BUSINESS_RULE_VIOLATION",
  message,
  retryable: false,
});

/** The rule a subscription stands for (pure): what `toRule` writes. */
export function ruleFromSubscription(input: {
  name: string;
  matchText: string;
  basCode: string;
  partnerId: string;
  bankAccountId: string;
  accountCurrency: string;
  cadence: "monthly" | "yearly";
  tolerancePct: string;
  /** the price valid today, if any */
  price: { amount: string; currency: string } | null;
}): banking.RuleInput {
  // a price in another currency than the account's cannot be an amount condition (the rule compares the row's
  // own amount); the rule then holds the text, the account and the direction only
  const expected =
    input.price && input.price.currency === input.accountCurrency ? input.price.amount : null;
  return {
    name: `${input.name} (subscription)`,
    description: "Made from the subscription — its text, account, direction, price and cadence",
    matchType: "contains",
    matchPattern: input.matchText,
    matchField: "all",
    basCode: input.basCode,
    partnerId: input.partnerId,
    noDocumentNeeded: false,
    bankAccountId: input.bankAccountId,
    sign: "out",
    expectedAmount: expected,
    tolerancePct: String(Math.min(Number(input.tolerancePct), 50)),
    cadence: input.cadence,
    priority: 110,
    isActive: true,
  };
}

/** *Make it a rule*: one rule from the subscription, refused when it has no text or is paid privately. */
export async function toRule(
  tx: TransactionClient,
  caller: CallerIdentity,
  audit: AuditLogger,
  subscriptionId: string,
  today: string,
): Promise<ServiceResult<{ ruleId: string; name: string }>> {
  const sub = await tx.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      prices: {
        where: { validFrom: { lte: new Date(`${today}T00:00:00Z`) } },
        orderBy: { validFrom: "desc" },
        take: 1,
      },
    },
  });
  if (!sub)
    return {
      error: {
        code: "NOT_FOUND",
        message: `Subscription not found: ${subscriptionId}`,
        retryable: false,
      },
    };
  if (!sub.matchText?.trim())
    return {
      error: violation(
        `${sub.name}: a rule needs the text its bank rows carry — set the subscription's match text first`,
      ),
    };
  const payer = await banking.payerAccount(tx, sub.paidFromAccountId);
  if (!payer || payer.kind === "private")
    return {
      error: violation(
        `${sub.name} is paid privately — a private instrument has no bank rows for a rule to categorise`,
      ),
    };
  const price = sub.prices[0];
  const stillValid = price && (!price.validTo || price.validTo >= new Date(`${today}T00:00:00Z`));
  const created = await banking.createRule(
    tx,
    caller,
    audit,
    ruleFromSubscription({
      name: sub.name,
      matchText: sub.matchText.trim(),
      basCode: sub.basCode,
      partnerId: sub.partnerId,
      bankAccountId: payer.id,
      accountCurrency: payer.currency,
      cadence: sub.cadence as "monthly" | "yearly",
      tolerancePct: sub.tolerancePct.toFixed(2),
      price: stillValid ? { amount: price.amount.toFixed(2), currency: price.currency } : null,
    }),
  );
  if (created.error) return { error: created.error };
  return { data: { ruleId: created.data.id, name: created.data.name } };
}
