// Real pg-boss against the test database (schema installed by the add_pgboss migration, owned by the
// app role). Workers poll every 2 s by default — the waits below are generous but bounded.
import { PgBoss } from "pg-boss";
import pgBossPackage from "pg-boss/package.json";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deadLetterQueueName, enqueue, getBoss, startJobs, stopJobs } from "./queue";
import type { JobDefinition } from "./types";

async function waitFor(check: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for job");
    await new Promise((r) => setTimeout(r, 100));
  }
}

const ran: string[] = [];
const dead: string[] = [];
let attempts = 0;

const okJob: JobDefinition<{ id: string }> = {
  name: "test.ok",
  options: { retryLimit: 0, policy: "exclusive" },
  handler: async (data) => {
    ran.push(data.id);
  },
};

const failingJob: JobDefinition<{ id: string }> = {
  name: "test.failing",
  options: { retryLimit: 1, retryDelay: 1, retryBackoff: false },
  handler: async () => {
    attempts++;
    throw new Error("boom");
  },
  onDeadLetter: async (data) => {
    dead.push(data.id);
  },
};

describe("kernel/jobs queue (pg-boss)", () => {
  beforeAll(async () => {
    const boss = await getBoss();
    // A clean slate for the test queues, whatever an aborted run left behind.
    for (const name of [okJob.name, failingJob.name, deadLetterQueueName(failingJob.name)]) {
      await boss.deleteQueue(name).catch(() => undefined);
    }
    const started = await startJobs([okJob, failingJob]);
    expect(started).toBe(true);
  });

  afterAll(async () => {
    await stopJobs(2_000);
  });

  it("the installed schema is the version this pg-boss package expects", async () => {
    const boss = await getBoss();
    expect(await boss.isInstalled()).toBe(true);
    expect(await boss.schemaVersion()).toBe(pgBossPackage.pgboss.schema);
  });

  it("queues are created with the job's retry options and a dead-letter queue when defined", async () => {
    const boss = await getBoss();
    const failing = await boss.getQueue(failingJob.name);
    expect(failing?.retryLimit).toBe(1);
    expect(failing?.deadLetter).toBe(deadLetterQueueName(failingJob.name));
    const ok = await boss.getQueue(okJob.name);
    expect(ok?.retryLimit).toBe(0);
    expect(ok?.policy).toBe("exclusive");
    expect(ok?.deadLetter ?? null).toBeNull();
  });

  it("enqueue → handler runs with the data; a singletonKey duplicate is dropped while queued", async () => {
    const first = await enqueue(okJob, { id: "a" }, { singletonKey: "a" });
    const dup = await enqueue(okJob, { id: "a-dup" }, { singletonKey: "a" });
    expect(first).toBeTruthy();
    expect(dup).toBeNull();

    await waitFor(() => ran.includes("a"));
    expect(ran).not.toContain("a-dup");
  });

  it("a throwing handler is retried, then the dead-letter handler runs", async () => {
    await enqueue(failingJob, { id: "f" });
    await waitFor(() => dead.includes("f"), 25_000);
    expect(attempts).toBe(2); // first attempt + retryLimit 1
  }, 30_000);

  // F92: a batch upload queues up to 50 OCR jobs at once. Each job name is its own queue with its own
  // worker taking one job at a time, so that backlog waits in its own queue and never sits in front of
  // another module's job (the invoice PDF render polled by the page — lessons, 2026-10-22).
  it("a backlog on one queue runs one at a time and never delays another queue's job", async () => {
    const boss = await getBoss();
    let inFlight = 0;
    let maxInFlight = 0;
    const slowDone: string[] = [];
    let slowDoneWhenFastRan = -1;
    const slowJob: JobDefinition<{ id: string }> = {
      name: "test.backlog-slow",
      options: { retryLimit: 0 },
      handler: async (data) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1_000));
        inFlight--;
        slowDone.push(data.id);
      },
    };
    const fastJob: JobDefinition<{ id: string }> = {
      name: "test.backlog-fast",
      options: { retryLimit: 0 },
      handler: async () => {
        slowDoneWhenFastRan = slowDone.length;
      },
    };
    for (const name of [slowJob.name, fastJob.name]) {
      await boss.deleteQueue(name).catch(() => undefined);
    }
    expect(await startJobs([slowJob, fastJob])).toBe(true);

    for (let i = 0; i < 5; i++) await enqueue(slowJob, { id: `s${i}` });
    await enqueue(fastJob, { id: "render" });

    await waitFor(() => slowDoneWhenFastRan >= 0, 15_000);
    expect(slowDoneWhenFastRan).toBeLessThan(5); // ran while the backlog was still there
    await waitFor(() => slowDone.length === 5, 20_000);
    expect(maxInFlight).toBe(1); // one OCR at a time per process
  }, 40_000);

  it("stopJobs is safe to call twice and getBoss restarts afterwards", async () => {
    await stopJobs(1_000);
    await stopJobs(1_000);
    const boss = await getBoss();
    expect(boss).toBeInstanceOf(PgBoss);
  });
});
