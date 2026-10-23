"use server";

import { z } from "zod/v4";
import { authedAction, ownerAction } from "@/kernel/actions/action-client";
import { can } from "@/kernel/auth/can";
import { listQuerySchema } from "@/kernel/list-query/schema";
import { uuid } from "@/kernel/validation/scalars";
import * as journal from "@/modules/journal/journal";
import { linkEntry, linkEntrySchema } from "@/modules/journal/links";
import {
  distinctJournalValues,
  getJournalEntry,
  JOURNAL_COLUMN_KEYS,
  type JournalColumn,
  journalDateHierarchy,
  listJournalEntries,
} from "@/modules/journal/queries";

const columnSchema = z.enum(JOURNAL_COLUMN_KEYS as [JournalColumn, ...JournalColumn[]]);
const forbidden = {
  error: {
    code: "FORBIDDEN" as const,
    message: "Not allowed to read the journal",
    retryable: false,
  },
};

// --- reads (the accountant may read) ---

export const getJournalEntryAction = authedAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "getJournalEntry" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "journal_entry")) return forbidden;
    return getJournalEntry(ctx.tx, parsedInput.id);
  });

export const listJournalEntriesAction = authedAction
  .schema(z.object({ query: listQuerySchema }))
  .metadata({ name: "listJournalEntries" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "journal_entry")) return forbidden;
    return { data: await listJournalEntries(ctx.tx, parsedInput.query) };
  });

export const distinctJournalValuesAction = authedAction
  .schema(z.object({ column: columnSchema, query: listQuerySchema }))
  .metadata({ name: "distinctJournalValues" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "journal_entry")) return forbidden;
    return { data: await distinctJournalValues(ctx.tx, parsedInput.column, parsedInput.query) };
  });

export const journalDateHierarchyAction = authedAction
  .schema(z.object({ column: columnSchema, query: listQuerySchema }))
  .metadata({ name: "journalDateHierarchy" })
  .action(async ({ ctx, parsedInput }) => {
    if (!can(ctx.callerIdentity, "read", "journal_entry")) return forbidden;
    return { data: await journalDateHierarchy(ctx.tx, parsedInput.column, parsedInput.query) };
  });

// --- writes (owner only) ---

export const createManualEntryAction = ownerAction
  .schema(journal.manualEntrySchema)
  .metadata({ name: "createManualJournalEntry" })
  .action(async ({ ctx, parsedInput }) => {
    return journal.createManualEntry(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });

export const categoriseEntryAction = ownerAction
  .schema(journal.categoriseSchema.extend({ id: uuid }))
  .metadata({ name: "categoriseJournalEntry" })
  .action(async ({ ctx, parsedInput }) => {
    const { id, ...facts } = parsedInput;
    return journal.categorise(ctx.tx, ctx.callerIdentity, ctx.audit, id, facts);
  });

export const deleteManualEntryAction = ownerAction
  .schema(z.object({ id: uuid }))
  .metadata({ name: "deleteManualJournalEntry" })
  .action(async ({ ctx, parsedInput }) => {
    return journal.deleteManualEntry(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput.id);
  });

/** *Link to…* on a manual entry's panel (T003): a document or a client invoice, the allocation proposed. */
export const linkEntryAction = ownerAction
  .schema(linkEntrySchema)
  .metadata({ name: "linkJournalEntry" })
  .action(async ({ ctx, parsedInput }) => {
    return linkEntry(ctx.tx, ctx.callerIdentity, ctx.audit, parsedInput);
  });
