/**
 * Clock abstraction for testable time-dependent logic.
 *
 * All time-dependent service code MUST use Clock — never `new Date()` directly.
 * Clock is injected as a function parameter to services, not as a module singleton.
 */

/** Testable time abstraction — injected into services that need time. */
export interface Clock {
  /** UTC instant — for timestamps, audit logs. */
  now(): Date;
  /** 'YYYY-MM-DD' in Europe/Stockholm — for date fields, rate lookups. */
  today(): string;
  /** 'YYYY-MM' in Europe/Stockholm — for period filtering, business keys. */
  currentPeriod(): string;
}

const STOCKHOLM_TZ = "Europe/Stockholm";

// Cached formatter — sv-SE locale formats as YYYY-MM-DD natively
const stockholmDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: STOCKHOLM_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatStockholmDate(date: Date): string {
  return stockholmDateFormatter.format(date);
}

/** Production clock — wraps system time with Europe/Stockholm timezone. */
class RealClock implements Clock {
  now(): Date {
    return new Date();
  }

  today(): string {
    return formatStockholmDate(this.now());
  }

  currentPeriod(): string {
    return this.today().slice(0, 7);
  }
}

/** Test clock — injectable fixed time with advance/setTime for test control. */
class TestClock implements Clock {
  private fixedTime: Date;

  /** @throws {Error} If fixedTime is an Invalid Date. */
  constructor(fixedTime: Date) {
    if (Number.isNaN(fixedTime.getTime())) {
      throw new Error("TestClock: Invalid Date provided");
    }
    this.fixedTime = new Date(fixedTime.getTime());
  }

  now(): Date {
    return new Date(this.fixedTime.getTime());
  }

  today(): string {
    return formatStockholmDate(this.fixedTime);
  }

  currentPeriod(): string {
    return this.today().slice(0, 7);
  }

  /** Replace the fixed time entirely. */
  setTime(date: Date): void {
    if (Number.isNaN(date.getTime())) {
      throw new Error("TestClock.setTime: Invalid Date provided");
    }
    this.fixedTime = new Date(date.getTime());
  }

  /** Advance fixed time by the given number of milliseconds. Must be non-negative. */
  advance(ms: number): void {
    if (ms < 0) {
      throw new Error("TestClock.advance: negative values are not supported");
    }
    this.fixedTime = new Date(this.fixedTime.getTime() + ms);
  }
}

/** Create a production clock using real system time. */
export function createClock(): Clock {
  return new RealClock();
}

/** Create a test clock with a fixed, controllable time. */
export function createTestClock(fixedTime: Date): TestClock {
  return new TestClock(fixedTime);
}
