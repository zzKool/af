// The build job `package.build` (spec FR-005, harvest R8, D17): collect in one transaction, download the documents
// outside any transaction, zip (pure), store the zip as a document and mark the build built — or mark it failed
// with the reason and store nothing. One job per build id (exclusive); a retry of a building build resumes.
import { withJobContext } from "@/kernel/jobs/context";
import type { JobDefinition } from "@/kernel/jobs/types";
import { logger } from "@/kernel/logging/logger";
import type { StorageService } from "@/kernel/storage/storage";
import { createStorageService } from "@/kernel/storage/storage";
import * as documents from "@/modules/documents";
import { collectPeriod, countsOf } from "../collect";
import { notesMd } from "../notes";
import { markBuilding, markBuilt, markFailed } from "../package";
import { monthsOf, parsePeriod } from "../period";
import type { PeriodData } from "../types";
import { type DocumentBytes, monthEntries, yearEntries, type ZipEntry, zipBytes } from "../zip";

export interface BuildPackageData {
  tenantId: string;
  userId: string;
  buildId: string;
}

export type BuildDeps = {
  storage?: StorageService;
  /** the build's "today" (ISO) — the invoices' derived states and the notes' stamp */
  today?: string;
  now?: () => Date;
};

/** The collected data of a period: the month itself, or the year with its twelve months. */
export type Collected = { data: PeriodData; months: PeriodData[] };

export async function collectForBuild(
  tx: Parameters<typeof collectPeriod>[0],
  period: string,
  today: string,
): Promise<Collected> {
  const p = parsePeriod(period);
  const data = await collectPeriod(tx, p, today);
  const months =
    p.kind === "year"
      ? await Promise.all(monthsOf(p.period).map((m) => collectPeriod(tx, parsePeriod(m), today)))
      : [];
  return { data, months };
}

/** The zip's entries from the collected data and the documents' bytes. */
export function entriesOf(collected: Collected, bytes: DocumentBytes): ZipEntry[] {
  return collected.data.period.kind === "year"
    ? yearEntries(collected.data, collected.months, bytes)
    : monthEntries(collected.data, bytes);
}

export async function buildPackage(
  { tenantId, userId, buildId }: BuildPackageData,
  deps: BuildDeps = {},
): Promise<void> {
  const storage = deps.storage ?? createStorageService();
  const now = deps.now ?? (() => new Date());
  const today = deps.today ?? now().toISOString().slice(0, 10);

  // 1. Claim the build (queued → building); a finished or missing build is nothing to do.
  const build = await withJobContext(tenantId, userId, (tx) => markBuilding(tx, buildId));
  if (!build) {
    logger.warn({ buildId }, "package.build: no queued build, skipping");
    return;
  }

  try {
    // 2. Collect (one transaction) and prepare the document readers (blob paths stay in the documents module).
    const { collected, readers } = await withJobContext(tenantId, userId, async (tx) => {
      const collected = await collectForBuild(tx, build.period, today);
      const ids = [
        ...new Set(
          [collected.data, ...collected.months].flatMap((d) => d.documents.map((doc) => doc.id)),
        ),
      ];
      const readers = await documents.documentReaders(tx, storage, ids);
      return { collected, readers };
    });

    // 3. Download outside any transaction — a missing document is a failed build, never a silent gap.
    const bytes = new Map<string, Uint8Array>();
    for (const [id, read] of readers) bytes.set(id, await read());

    // 4. Zip (pure) and store + mark built in one short transaction.
    const zip = zipBytes(entriesOf(collected, bytes), collected.data.period.to);
    const notes = notesMd(collected.data);
    await withJobContext(tenantId, userId, async (tx, caller, audit) => {
      const stored = await documents.storeGeneratedDocument(tx, caller, audit, storage, {
        bytes: zip,
        businessKey: build.businessKey,
        fileName: build.businessKey,
        mimeType: "application/zip",
        prefixType: "package",
      });
      if (stored.error) throw new Error(stored.error.message);
      await markBuilt(tx, audit, buildId, {
        documentId: stored.data.id,
        counts: countsOf(collected.data),
        flags: collected.data.flags.length,
        notes,
        builtAt: now(),
      });
    });
    logger.info(
      { buildId, period: build.period, version: build.version, bytes: zip.length },
      "package.build: stored",
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error({ err: e, buildId }, "package.build: failed");
    await withJobContext(tenantId, userId, (tx, _caller, audit) =>
      markFailed(tx, audit, buildId, message),
    );
  }
}

export const buildPackageJob: JobDefinition<BuildPackageData> = {
  name: "package.build",
  options: {
    policy: "exclusive",
    retryLimit: 0,
    expireInSeconds: 600,
  },
  handler: (data) => buildPackage(data),
};

export const packageJobs = [buildPackageJob];
