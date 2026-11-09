// The subscriptions hero (F164) — pure: a month of the active ones in the base, a yearly one a twelfth.
import { describe, expect, it } from "vitest";
import { subscriptionsOverviewFrom } from "./overview";

const sub = (o: Record<string, unknown>) =>
  ({
    name: "Tool",
    partnerName: "Vendor A",
    active: true,
    cadence: "monthly",
    expectedAmount: "20.00",
    expectedCurrency: "USD",
    nextDate: "2026-08-01",
    attention: 0,
    ...o,
  }) as Parameters<typeof subscriptionsOverviewFrom>[0][number];

describe("subscriptionsOverviewFrom", () => {
  const o = subscriptionsOverviewFrom(
    [
      sub({}),
      sub({
        partnerName: "Vendor B",
        cadence: "yearly",
        expectedAmount: "120.00",
        nextDate: "2026-07-20",
      }),
      sub({ partnerName: "Vendor C", expectedCurrency: "JPY" }), // no rate → left out, counted
      sub({ partnerName: "Vendor D", active: false, attention: 2 }),
      sub({ partnerName: "Vendor E", expectedAmount: null, attention: 1 }),
    ],
    (c) => (c === "USD" ? "10.000000" : null),
  );
  it("a month in the base, a yearly one a twelfth; the unpriced counted, not guessed", () => {
    expect(o.active).toBe(4);
    expect(o.perMonth).toBe("300.00"); // 20 × 10 + 120 × 10 / 12
    expect(o.perYear).toBe("3600.00");
    expect(o.unpriced).toBe(2);
    expect(o.vendors[0]).toEqual({ name: "Vendor A", perMonth: "200.00" });
    expect(o.next[0]?.name).toBe("Vendor B");
    expect(o.attention).toBe(3);
  });
});
