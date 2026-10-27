// kernel/ai on responses of llama-server's shape (invented content) — never on our own mock (lessons 2026-10-24).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const logged: unknown[][] = [];
vi.mock("@/kernel/logging/logger", () => ({
  logger: {
    info: vi.fn((...a: unknown[]) => logged.push(a)),
    warn: vi.fn((...a: unknown[]) => logged.push(a)),
    error: vi.fn((...a: unknown[]) => logged.push(a)),
    debug: vi.fn(),
  },
}));

import {
  aiConcurrency,
  aiStatus,
  createAiService,
  createMockAiService,
  resetAiStatusCache,
  resolveAiProvider,
} from "./ai";
import { jsonSchemaOf, parseAnswer } from "./schema";

const ENV = {
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: "http://ai.test:8080/v1/",
  AI_MODEL: "af-local",
  AI_API_KEY: "k-123",
};

const schema = z
  .object({ basCode: z.enum(["654", "583"]), confidence: z.number().min(0).max(1) })
  .strict();

/** a llama-server /v1/chat/completions response (shape as served; values invented) */
function chatResponse(content: string) {
  return {
    id: "chatcmpl-x",
    object: "chat.completion",
    created: 1_761_600_000,
    model: "af-local",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 1612, completion_tokens: 21, total_tokens: 1633 },
    timings: { cache_n: 1498, prompt_n: 114, predicted_n: 21 },
  };
}

const call = {
  task: "test.bas",
  promptVersion: "v1",
  messages: [
    { role: "system" as const, content: "Answer in JSON." },
    { role: "user" as const, content: "CLOUDHOST AB 120.00" },
  ],
  schema,
};

beforeEach(() => {
  logged.length = 0;
  resetAiStatusCache();
});

describe("resolveAiProvider", () => {
  it("is off unless asked for, and says why", () => {
    expect(resolveAiProvider({})).toEqual({ kind: "off", reason: "AI_PROVIDER not set" });
    expect(resolveAiProvider({ AI_PROVIDER: "gpt" }).kind).toBe("off");
    expect(resolveAiProvider({ AI_PROVIDER: "openai-compatible" })).toEqual({
      kind: "off",
      reason: "AI_BASE_URL and AI_MODEL not set",
    });
  });
  it("the mock only by name; the endpoint without its trailing slash; the timeout default", () => {
    expect(resolveAiProvider({ AI_PROVIDER: "mock" })).toEqual({ kind: "mock" });
    expect(resolveAiProvider(ENV)).toEqual({
      kind: "openai-compatible",
      baseUrl: "http://ai.test:8080/v1",
      apiKey: "k-123",
      model: "af-local",
      timeoutMs: 60_000,
    });
    expect(aiConcurrency({})).toBe(1);
    expect(aiConcurrency({ AI_CONCURRENCY: "2" })).toBe(2);
    expect(aiConcurrency({ AI_CONCURRENCY: "x" })).toBe(1);
  });
});

describe("complete — the OpenAI-compatible endpoint", () => {
  it("sends the schema as response_format, temperature 0, the key; parses and types the answer", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify(chatResponse('{"basCode":"654","confidence":0.82}'))),
    );
    const ai = createAiService(ENV, fetchImpl as unknown as typeof fetch);
    const r = await ai.complete(call);
    expect(r).toMatchObject({
      ok: true,
      data: { basCode: "654", confidence: 0.82 },
      model: "af-local",
      promptVersion: "v1",
      tokens: { prompt: 1612, completion: 21, cached: 1498 },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://ai.test:8080/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(300);
    expect(body.response_format.type).toBe("json_schema");
    expect([...body.response_format.json_schema.schema.properties.basCode.enum].sort()).toEqual([
      "583",
      "654",
    ]);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe(
      "Bearer k-123",
    );
  });

  it("an answer outside the enum is invalid_output — the grammar is not trusted alone", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify(chatResponse('{"basCode":"999","confidence":0.9}')));
    const r = await createAiService(ENV, fetchImpl as unknown as typeof fetch).complete(call);
    expect(r).toMatchObject({ ok: false, error: "invalid_output", retryable: false });
  });

  it("a fenced JSON block is accepted; prose is not", async () => {
    const fenced = async () =>
      new Response(
        JSON.stringify(chatResponse('```json\n{"basCode":"583","confidence":0.6}\n```')),
      );
    expect((await createAiService(ENV, fenced as unknown as typeof fetch).complete(call)).ok).toBe(
      true,
    );
    const prose = async () => new Response(JSON.stringify(chatResponse("I think it is travel.")));
    expect(
      await createAiService(ENV, prose as unknown as typeof fetch).complete(call),
    ).toMatchObject({
      ok: false,
      error: "invalid_output",
    });
  });

  it("a timeout and an unreachable endpoint are retryable; HTTP 401 is not", async () => {
    const timeout = async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    };
    expect(
      await createAiService(ENV, timeout as unknown as typeof fetch).complete(call),
    ).toMatchObject({
      ok: false,
      error: "timeout",
      retryable: true,
    });
    const refused = async () => {
      throw new TypeError("fetch failed");
    };
    expect(
      await createAiService(ENV, refused as unknown as typeof fetch).complete(call),
    ).toMatchObject({
      ok: false,
      error: "unavailable",
      retryable: true,
    });
    const denied = async () => new Response("no", { status: 401 });
    expect(
      await createAiService(ENV, denied as unknown as typeof fetch).complete(call),
    ).toMatchObject({
      ok: false,
      error: "unavailable",
      retryable: false,
    });
  });

  it("never logs the prompt or the answer (D51)", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify(chatResponse('{"basCode":"654","confidence":0.82}')));
    await createAiService(ENV, fetchImpl as unknown as typeof fetch).complete(call);
    const text = JSON.stringify(logged);
    expect(text).not.toContain("CLOUDHOST");
    expect(text).not.toContain("Answer in JSON");
    expect(text).not.toContain('"basCode"');
    expect(text).toContain("test.bas");
  });
});

describe("off and mock", () => {
  it("off never calls anything", async () => {
    const fetchImpl = vi.fn();
    const ai = createAiService({}, fetchImpl as unknown as typeof fetch);
    expect(ai.kind).toBe("off");
    expect(await ai.complete(call)).toMatchObject({
      ok: false,
      error: "unavailable",
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("the mock answers only the tasks it knows, through the same schema", async () => {
    const mock = createMockAiService({ "test.bas": { basCode: "583", confidence: 0.7 } });
    expect(await mock.complete(call)).toMatchObject({
      ok: true,
      data: { basCode: "583" },
      model: "mock",
    });
    expect(await mock.complete({ ...call, task: "other" })).toMatchObject({
      ok: false,
      error: "unavailable",
    });
  });
});

describe("aiStatus", () => {
  it("off / mock without a call; ok lists the models; cached 60 s", async () => {
    expect(await aiStatus({})).toEqual({ state: "off", reason: "AI_PROVIDER not set" });
    expect(await aiStatus({ AI_PROVIDER: "mock" })).toEqual({ state: "mock" });
    let t = 1_000;
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: "af-local" }] })),
    );
    const s = await aiStatus(ENV, fetchImpl as unknown as typeof fetch, () => t);
    expect(s).toMatchObject({ state: "ok", model: "af-local", models: ["af-local"] });
    t += 30_000;
    await aiStatus(ENV, fetchImpl as unknown as typeof fetch, () => t);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toBeDefined();
  });
  it("unreachable says why, without failing", async () => {
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await aiStatus(ENV, fetchImpl as unknown as typeof fetch)).toEqual({
      state: "unreachable",
      model: "af-local",
      detail: "the endpoint is unreachable",
    });
  });
});

describe("schema", () => {
  it("the JSON schema accepts exactly what Zod accepts (no $schema key)", () => {
    const js = jsonSchemaOf(schema);
    expect(js.$schema).toBeUndefined();
    expect(js.required).toEqual(["basCode", "confidence"]);
    expect(parseAnswer(schema, '{"basCode":"654","confidence":1}').ok).toBe(true);
    expect(parseAnswer(schema, '{"basCode":"654","confidence":1.5}').ok).toBe(false);
    expect(parseAnswer(schema, '{"basCode":"654","confidence":1,"extra":1}').ok).toBe(false);
  });
});
