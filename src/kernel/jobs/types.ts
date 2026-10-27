// Job contracts of the kernel (D17: pg-boss in-process; constitution §1.9: queued in Postgres, resumable).
// A job carries ids only — the state machine lives on the entity, so every attempt is a resume.

export interface JobOptions {
  /** Attempts after the first one; the queue's default when omitted. */
  retryLimit?: number;
  /** Seconds between attempts (exponential when retryBackoff). */
  retryDelay?: number;
  retryBackoff?: boolean;
  /** Seconds an attempt may run before pg-boss considers it lost and retries it. */
  expireInSeconds?: number;
  /**
   * `exclusive`: at most one job per `singletonKey` queued, retrying or active at a time (a second
   * enqueue is dropped) — the policy for "process entity X". `standard` (default) queues every enqueue.
   * Fixed at queue creation.
   */
  policy?: "standard" | "exclusive";
}

export interface JobContext {
  /** pg-boss job id. */
  id: string;
  /** 0 on the first attempt. */
  attempt: number;
  /**
   * On a dead-letter run only (F110): what the original job's last attempt threw, and how many attempts it
   * took — so the handler can write *why* on the entity, not just *that*.
   */
  failure?: { error: string; attempts: number };
}

export interface JobDefinition<TData extends object = object> {
  /** Queue name: `<module>.<verb>-<entity>`, e.g. `documents.process-document`. */
  name: string;
  options?: JobOptions;
  /** Throw to retry (until retryLimit); return to complete. (Method syntax: bivariant, so a registry can hold JobDefinition<object>.) */
  handler(data: TData, ctx: JobContext): Promise<void>;
  /**
   * Runs once the job has failed terminally (retries exhausted or attempt expired) — the safety net
   * that leaves the entity in a consistent state. Routed through a dead-letter queue `<name>.dead`.
   */
  onDeadLetter?(data: TData, ctx: JobContext): Promise<void>;
}

export interface EnqueueOptions {
  /** On an `exclusive` queue: at most one job with this key queued or active; a duplicate returns null. */
  singletonKey?: string;
  /** Delay in seconds before the job becomes available. */
  startAfterSeconds?: number;
}

export interface ScheduleDefinition<TData extends object = object> {
  job: JobDefinition<TData>;
  /** Standard 5-field cron expression, evaluated in `tz`. */
  cron: string;
  tz?: string;
  data?: TData;
  /**
   * What happens to occurrences that came due while the app was down (scaled to zero for weeks):
   * `once` enqueues a single catch-up job on start, `skip` drops them. Default `once` (constitution §1.9).
   */
  missed?: "once" | "skip";
}
