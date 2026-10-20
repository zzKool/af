// The identity a `/print/...` page runs as. Print pages have no session: the renderer opened them
// with a print token, and the token names the tenant and the user who asked for the PDF.
import { notFound } from "next/navigation";
import { PRINT_TOKEN_PARAM, verifyPrintToken } from "@/kernel/pdf/print-token";
import type { CallerIdentity } from "./caller-identity";

export type PrintSearchParams = Record<string, string | string[] | undefined>;

/**
 * For a print page: `const caller = await requirePrintCaller(searchParams, "/print/invoice/" + id)`.
 * A missing, foreign, expired or mis-bound token is a 404 — a print page is never discoverable.
 * Role `owner`, source `system`: the page renders what the issuing user may see; nothing is written.
 */
export async function requirePrintCaller(
  searchParams: PrintSearchParams | Promise<PrintSearchParams>,
  path: string,
): Promise<CallerIdentity> {
  const params = await searchParams;
  const raw = params[PRINT_TOKEN_PARAM];
  const token = Array.isArray(raw) ? raw[0] : raw;
  const payload = verifyPrintToken(token, path);
  if (!payload) notFound();
  return { tenantId: payload.tenantId, userId: payload.userId, role: "owner", source: "system" };
}
