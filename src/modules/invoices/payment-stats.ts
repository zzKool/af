// When will it be paid? (F143, Pulse phase 7) — the pure half of the client's payment history: the spread of its
// payments and the days the money should come. Client-safe; the query is `payment-history.ts`.
import { addDays } from "@/kernel/clock/calendar";

export type PaidInvoice = {
  id: string;
  number: string | null;
  issueDate: string;
  dueDate: string | null;
  paidOn: string;
  /** issue → paid */
  days: number;
  /** paid after the due date */
  late: boolean;
};

export type PaymentStats = {
  count: number;
  minDays: number;
  maxDays: number;
  avgDays: number;
  lateCount: number;
};

/** The spread of a client's payments (pure); null with none. */
export function paymentStats(paid: readonly PaidInvoice[]): PaymentStats | null {
  if (paid.length === 0) return null;
  const days = paid.map((p) => p.days);
  return {
    count: paid.length,
    minDays: Math.min(...days),
    maxDays: Math.max(...days),
    avgDays: Math.round(days.reduce((s, d) => s + d, 0) / days.length),
    lateCount: paid.filter((p) => p.late).length,
  };
}

/** When the money should come if sent on `sendDay`: the day the client's usual spread lands on (pure). */
export function expectedPayment(
  stats: PaymentStats | null,
  sendDay: string,
): { from: string; to: string } | null {
  if (!stats) return null;
  return { from: addDays(sendDay, stats.minDays), to: addDays(sendDay, stats.maxDays) };
}
