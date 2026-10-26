"use server";

// Global search (F93, D56): the palette's one action — any role (`can()` decides per kind inside), RLS by the
// tenant transaction, rate-limited like every action.
import { z } from "zod/v4";
import { authedAction } from "@/kernel/actions/action-client";
import { searchAll } from "./search";

export const globalSearchAction = authedAction
  .schema(z.object({ q: z.string().max(100) }).strict())
  .metadata({ name: "globalSearch" })
  .action(async ({ ctx, parsedInput }) => ({
    data: await searchAll(ctx.tx, ctx.callerIdentity, parsedInput.q),
  }));
