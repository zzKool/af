// The output contract sent to the model: the Zod schema as JSON Schema (Zod 4's own converter). llama-server
// turns it into a grammar, so an enum value outside the list cannot be produced; the answer is re-parsed with
// the same Zod schema anyway — a server without grammar support must not slip through.
import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

export function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, {
    target: "draft-2020-12",
  }) as JsonSchema;
  return rest;
}

/**
 * The model's text → the typed answer, or why not. Tolerates a fenced block (```json … ```) — some servers wrap
 * the JSON even under a grammar; anything else that is not the schema is `invalid_output`.
 */
export function parseAnswer<T>(
  schema: z.ZodType<T>,
  text: string,
): { ok: true; data: T } | { ok: false; detail: string } {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, detail: "the answer is not JSON" };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      detail: `the answer does not fit the schema (${first?.path.join(".") || "root"}: ${first?.message ?? "invalid"})`,
    };
  }
  return { ok: true, data: parsed.data };
}
