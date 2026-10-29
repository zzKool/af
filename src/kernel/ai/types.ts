// Contracts of the local-AI adapter (F98, specs/ai, docs/local-ai.md §2). Framework-free.
import type { z } from "zod";

export type AiMessage = { role: "system" | "user" | "assistant"; content: string };

export interface AiCall<T> {
  /** `<module>.<what>` — the log key and the metrics key, e.g. `banking.bas-proposal` */
  task: string;
  /** bumped with any change of the prompt text — logged with every call */
  promptVersion: string;
  /** static parts first (the server's prompt cache reuses them), the row last */
  messages: AiMessage[];
  /** the output: sent as `response_format: json_schema` (the grammar) AND re-parsed here */
  schema: z.ZodType<T>;
  /** default 300 — proposals are short */
  maxTokens?: number;
  /** default 0 — the same row gives the same answer */
  temperature?: number;
}

export type AiErrorCode = "unavailable" | "timeout" | "invalid_output";

export type AiResult<T> =
  | {
      ok: true;
      data: T;
      model: string;
      promptVersion: string;
      durationMs: number;
      tokens: { prompt: number; completion: number; cached: number };
    }
  | { ok: false; error: AiErrorCode; retryable: boolean; detail: string };

export interface AiService {
  /** which provider answers — `off` never calls anything */
  readonly kind: AiProvider["kind"];
  complete<T>(call: AiCall<T>): Promise<AiResult<T>>;
}

export type AiProvider =
  | {
      kind: "openai-compatible";
      baseUrl: string;
      apiKey: string | null;
      model: string;
      timeoutMs: number;
    }
  | { kind: "mock" }
  | { kind: "off"; reason: string };

/** What Settings → AI and `/api/health` show: never a prompt, never an answer. */
export type AiStatus =
  | { state: "off"; reason: string }
  | { state: "mock" }
  | { state: "ok"; model: string; models: string[]; latencyMs: number }
  | { state: "unreachable"; model: string; detail: string };
