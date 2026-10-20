// DTOs of the numbering module (never Prisma types).

export interface SeriesStatus {
  series: string;
  /** The number the next issue gets. */
  nextValue: number;
  /** 0 when nothing was issued yet. */
  lastIssued: number;
  updatedAt: Date | null;
}
