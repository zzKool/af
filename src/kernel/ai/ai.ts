// The local-AI adapter (F98, specs/ai, docs/local-ai.md §2): one OpenAI-compatible chat endpoint — llama-server
// or Ollama on the owner's AI VM, a hosted model later — and nothing else. The only file that talks HTTP to a
// model (architecture guard). Mirrors kernel/ocr: env vars only, a mock only when named, never a silent fallback.
//
// Privacy (D51): the prompt carries real rows. NEVER log a prompt or an answer — only task, model, prompt
// version, duration and token counts.
import { logger } from "@/kernel/logging/logger";
import { jsonSchemaOf, parseAnswer } from "./schema";
import type { AiCall, AiProvider, AiResult, AiService, AiStatus } from "./types";

// MUST NOT import from next/* or src/components/*

type Env = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 60_000;

export const AI_NOT_CONFIGURED_HINT =
  "set AI_PROVIDER=openai-compatible, AI_BASE_URL and AI_MODEL (or AI_PROVIDER=mock in dev and tests)";

export function resolveAiProvider(env: Env = process.env): AiProvider {
  const wanted = env.AI_PROVIDER?.trim().toLowerCase();
  if (!wanted) return { kind: "off", reason: "AI_PROVIDER not set" };
  if (wanted === "mock") return { kind: "mock" };
  if (wanted !== "openai-compatible")
    return { kind: "off", reason: `unknown AI_PROVIDER "${env.AI_PROVIDER}"` };
  const baseUrl = env.AI_BASE_URL?.trim().replace(/\/+$/, "");
  const model = env.AI_MODEL?.trim();
  const missing = [!baseUrl && "AI_BASE_URL", !model && "AI_MODEL"].filter(Boolean);
  if (!baseUrl || !model) return { kind: "off", reason: `${missing.join(" and ")} not set` };
  const timeout = Number(env.AI_TIMEOUT_MS);
  return {
    kind: "openai-compatible",
    baseUrl,
    apiKey: env.AI_API_KEY?.trim() || null,
    model,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

/** How many model requests at a time (`AI_CONCURRENCY`, default 1 — a CPU box serves one). */
export function aiConcurrency(env: Env = process.env): number {
  const n = Number(env.AI_CONCURRENCY);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

// --- the OpenAI-compatible provider ---

type ChatResponse = {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  /** llama-server's own counters, when present */
  timings?: { cache_n?: number };
};

function headers(apiKey: string | null): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

export function createOpenAiCompatibleService(
  provider: Extract<AiProvider, { kind: "openai-compatible" }>,
  fetchImpl: typeof fetch = fetch,
): AiService {
  return {
    kind: "openai-compatible",
    async complete<T>(call: AiCall<T>): Promise<AiResult<T>> {
      const started = Date.now();
      const body = {
        model: provider.model,
        messages: call.messages,
        temperature: call.temperature ?? 0,
        max_tokens: call.maxTokens ?? 300,
        stream: false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: call.task.replace(/[^a-zA-Z0-9_-]/g, "_"),
            strict: true,
            schema: jsonSchemaOf(call.schema),
          },
        },
      };
      let res: Response;
      try {
        res = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: headers(provider.apiKey),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(provider.timeoutMs),
        });
      } catch (e) {
        const timeout = isAbort(e);
        logger.warn(
          {
            task: call.task,
            promptVersion: call.promptVersion,
            durationMs: Date.now() - started,
            timeout,
          },
          timeout
            ? "ai: the model did not answer in time"
            : "ai: the model endpoint is unreachable",
        );
        return timeout
          ? {
              ok: false,
              error: "timeout",
              retryable: true,
              detail: `no answer within ${provider.timeoutMs} ms`,
            }
          : {
              ok: false,
              error: "unavailable",
              retryable: true,
              detail: "the model endpoint is unreachable",
            };
      }
      if (!res.ok) {
        logger.warn(
          { task: call.task, status: res.status },
          "ai: the model endpoint refused the call",
        );
        return {
          ok: false,
          error: "unavailable",
          retryable: res.status >= 500 || res.status === 429,
          detail: `the model endpoint answered HTTP ${res.status}`,
        };
      }
      let json: ChatResponse;
      try {
        json = (await res.json()) as ChatResponse;
      } catch {
        return {
          ok: false,
          error: "invalid_output",
          retryable: false,
          detail: "the response is not JSON",
        };
      }
      const text = json.choices?.[0]?.message?.content ?? "";
      const parsed = parseAnswer(call.schema, text);
      const durationMs = Date.now() - started;
      const tokens = {
        prompt: json.usage?.prompt_tokens ?? 0,
        completion: json.usage?.completion_tokens ?? 0,
        cached: json.usage?.prompt_tokens_details?.cached_tokens ?? json.timings?.cache_n ?? 0,
      };
      const model = json.model ?? provider.model;
      if (!parsed.ok) {
        logger.warn(
          { task: call.task, promptVersion: call.promptVersion, model, durationMs },
          "ai: the answer did not fit the schema",
        );
        return { ok: false, error: "invalid_output", retryable: false, detail: parsed.detail };
      }
      logger.info(
        { task: call.task, promptVersion: call.promptVersion, model, durationMs, tokens },
        "ai: answered",
      );
      return {
        ok: true,
        data: parsed.data,
        model,
        promptVersion: call.promptVersion,
        durationMs,
        tokens,
      };
    },
  };
}

// --- off and mock ---

function createOffService(reason: string): AiService {
  return {
    kind: "off",
    complete: async () => ({
      ok: false,
      error: "unavailable",
      retryable: false,
      detail: `AI is off (${reason}) — ${AI_NOT_CONFIGURED_HINT}`,
    }),
  };
}

/**
 * The mock (dev and tests, named only): answers from a fixed table by task — PR 2 adds the stage-2 tasks. A task
 * without an answer is `unavailable`, like a model that is not there; nothing is invented for it.
 */
export function createMockAiService(answers: Record<string, unknown> = MOCK_ANSWERS): AiService {
  return {
    kind: "mock",
    async complete<T>(call: AiCall<T>): Promise<AiResult<T>> {
      if (!(call.task in answers))
        return {
          ok: false,
          error: "unavailable",
          retryable: false,
          detail: `the mock has no answer for ${call.task}`,
        };
      const parsed = call.schema.safeParse(answers[call.task]);
      if (!parsed.success)
        return {
          ok: false,
          error: "invalid_output",
          retryable: false,
          detail: "the mock's answer does not fit",
        };
      return {
        ok: true,
        data: parsed.data,
        model: "mock",
        promptVersion: call.promptVersion,
        durationMs: 0,
        tokens: { prompt: 0, completion: 0, cached: 0 },
      };
    },
  };
}

/** The mock's answers by task (PR 2 fills it with invented, fixed answers for the e2e). */
export const MOCK_ANSWERS: Record<string, unknown> = {};

export function createAiService(
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): AiService {
  const provider = resolveAiProvider(env);
  switch (provider.kind) {
    case "openai-compatible":
      return createOpenAiCompatibleService(provider, fetchImpl);
    case "mock":
      logger.warn("AI_PROVIDER=mock — fixed invented answers; never on real data");
      return createMockAiService();
    case "off":
      return createOffService(provider.reason);
  }
}

// --- status: Settings → AI and /api/health (no prompt, no answer — the list of models only) ---

const STATUS_TTL_MS = 60_000;
let cached: { at: number; status: AiStatus } | null = null;

/** Clears the 60 s status cache (tests; *Check now*). */
export function resetAiStatusCache(): void {
  cached = null;
}

export async function aiStatus(
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<AiStatus> {
  const provider = resolveAiProvider(env);
  if (provider.kind === "off") return { state: "off", reason: provider.reason };
  if (provider.kind === "mock") return { state: "mock" };
  if (cached && now() - cached.at < STATUS_TTL_MS) return cached.status;
  const started = now();
  let status: AiStatus;
  try {
    const res = await fetchImpl(`${provider.baseUrl}/models`, {
      headers: headers(provider.apiKey),
      signal: AbortSignal.timeout(1_500),
    });
    if (!res.ok) {
      status = { state: "unreachable", model: provider.model, detail: `HTTP ${res.status}` };
    } else {
      const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
      const models = (json.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
      status = { state: "ok", model: provider.model, models, latencyMs: now() - started };
    }
  } catch (e) {
    status = {
      state: "unreachable",
      model: provider.model,
      detail: isAbort(e) ? "no answer within 1.5 s" : "the endpoint is unreachable",
    };
  }
  cached = { at: now(), status };
  return status;
}
