// pg-boss behind the kernel's job contract (D17). The only file that imports pg-boss (guard).
//
// One Postgres-backed queue in the same container: no external job service, no signing keys, works
// offline on the homelab, survives the app being scaled to zero (constitution §1.9) — jobs wait in
// pgboss.job, schedules catch up with `missed: "once"` on the next start.
//
// The instance lives on globalThis: Next.js gives instrumentation.ts and each route its own module
// graph, so a plain module singleton would start one pg-boss per bundle.
import { PgBoss } from "pg-boss";
import { logger } from "@/kernel/logging/logger";
import { runReported } from "./run-reported";
import type { EnqueueOptions, JobDefinition, ScheduleDefinition } from "./types";

const SCHEMA = "pgboss";
const DEFAULT_TZ = "Europe/Stockholm";

const QUEUE_DEFAULTS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 15 * 60,
  policy: "standard",
} as const;

interface JobsGlobal {
  boss?: PgBoss;
  starting?: Promise<PgBoss>;
  workers: Set<string>;
}

const globalForJobs = globalThis as unknown as { __afJobs?: JobsGlobal };
function state(): JobsGlobal {
  if (!globalForJobs.__afJobs) globalForJobs.__afJobs = { workers: new Set() };
  return globalForJobs.__afJobs;
}

/** `JOBS_DISABLED=1` keeps the queue out of builds, scripts and tests that never need it. */
export function jobsEnabled(): boolean {
  return process.env.JOBS_DISABLED !== "1" && !!process.env.DATABASE_URL;
}

export function deadLetterQueueName(name: string): string {
  return `${name}.dead`;
}

function createBoss(): PgBoss {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    schema: SCHEMA,
    // The schema is installed by a Prisma migration owned by the app role (see migration add_pgboss);
    // pg-boss refuses to start when the stored version differs from the package's.
    migrate: false,
    createSchema: false,
    application_name: "af-jobs",
    max: Number(process.env.JOBS_POOL_MAX ?? 2),
  });
  boss.on("error", (error) => logger.error({ err: error }, "jobs: pg-boss error"));
  boss.on("warning", (warning) => logger.warn({ warning }, "jobs: pg-boss warning"));
  return boss;
}

/** The started pg-boss instance of this process (started on first use). */
export async function getBoss(): Promise<PgBoss> {
  const s = state();
  if (s.boss) return s.boss;
  if (!s.starting) {
    s.starting = (async () => {
      const boss = createBoss();
      await boss.start();
      s.boss = boss;
      return boss;
    })().catch((error) => {
      s.starting = undefined;
      throw error;
    });
  }
  return s.starting;
}

async function ensureQueue(boss: PgBoss, job: JobDefinition): Promise<void> {
  const options = { ...QUEUE_DEFAULTS, ...job.options };
  if (job.onDeadLetter) {
    const dead = deadLetterQueueName(job.name);
    await boss.createQueue(dead, { retryLimit: 2, retryDelay: 10 });
  }
  // pg-boss validates `'deadLetter' in options`, so the key is only present when there is one.
  const queueOptions = job.onDeadLetter
    ? { ...options, deadLetter: deadLetterQueueName(job.name) }
    : options;
  // create_queue is ON CONFLICT DO NOTHING — updateQueue applies option changes to an existing queue
  // (all but the policy, which pg-boss fixes at creation).
  await boss.createQueue(job.name, queueOptions);
  const { policy: _policy, ...updatable } = queueOptions;
  await boss.updateQueue(job.name, updatable);
}

/**
 * Start the in-process worker: create the queues, attach one worker per job (and per dead-letter
 * queue), register the schedules. Idempotent per process; a failure is logged, never fatal — the app
 * must keep serving pages when the queue is unavailable.
 */
export async function startJobs(
  jobs: readonly JobDefinition<object>[],
  schedules: readonly ScheduleDefinition<object>[] = [],
): Promise<boolean> {
  if (!jobsEnabled()) {
    logger.info("jobs: disabled (JOBS_DISABLED or no DATABASE_URL)");
    return false;
  }
  try {
    const boss = await getBoss();
    const s = state();
    for (const job of jobs) {
      if (s.workers.has(job.name)) continue;
      await ensureQueue(boss, job);
      await boss.work<object>(job.name, { batchSize: 1 }, async ([j]) => {
        await runReported(job.name, job.handler.bind(job), j.data, {
          id: j.id,
          attempt: j.retryCount,
        });
      });
      if (job.onDeadLetter) {
        const onDeadLetter = job.onDeadLetter.bind(job);
        await boss.work<object>(deadLetterQueueName(job.name), { batchSize: 1 }, async ([j]) => {
          await runReported(deadLetterQueueName(job.name), onDeadLetter, j.data, {
            id: j.id,
            attempt: j.retryCount,
          });
        });
      }
      s.workers.add(job.name);
    }
    for (const schedule of schedules) {
      await boss.schedule(schedule.job.name, schedule.cron, schedule.data ?? null, {
        tz: schedule.tz ?? DEFAULT_TZ,
        missed: schedule.missed ?? "once",
      });
    }
    logger.info(
      { jobs: jobs.map((j) => j.name), schedules: schedules.map((x) => x.job.name) },
      "jobs: worker started",
    );
    return true;
  } catch (error) {
    logger.error({ err: error }, "jobs: worker failed to start — queue unavailable");
    return false;
  }
}

/** Queue a job. Returns the job id, or null when a `singletonKey` duplicate is already queued. */
export async function enqueue<TData extends object>(
  job: JobDefinition<TData>,
  data: TData,
  options: EnqueueOptions = {},
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(job.name, data, {
    singletonKey: options.singletonKey,
    startAfter: options.startAfterSeconds,
  });
}

/** Graceful stop: lets active attempts finish (up to `timeoutMs`), then closes the pool. */
export async function stopJobs(timeoutMs = 10_000): Promise<void> {
  const s = state();
  const boss = s.boss;
  if (!boss) return;
  s.boss = undefined;
  s.starting = undefined;
  s.workers.clear();
  await boss.stop({ graceful: true, timeout: timeoutMs, close: true });
}
