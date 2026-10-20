import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrintToken, PRINT_TOKEN_TTL_SECONDS, verifyPrintToken } from "./print-token";

const PATH = "/print/invoice/8d1b2c3e-0000-4000-8000-000000000001";
const payload = { tenantId: "tenant-1", userId: "user-1", path: PATH };
const now = new Date("2026-10-20T10:00:00Z");

describe("print tokens", () => {
  const previousSecret = process.env.AUTH_SECRET;
  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret-for-print-tokens-at-least-32-chars";
  });
  afterAll(() => {
    process.env.AUTH_SECRET = previousSecret;
  });

  it("round-trips tenant, user and path", () => {
    const token = createPrintToken(payload, now);
    expect(verifyPrintToken(token, PATH, now)).toMatchObject(payload);
  });

  it("is bound to the path it was minted for", () => {
    const token = createPrintToken(payload, now);
    expect(verifyPrintToken(token, "/print/invoice/other", now)).toBeNull();
  });

  it("expires after the TTL", () => {
    const token = createPrintToken(payload, now);
    const later = new Date(now.getTime() + (PRINT_TOKEN_TTL_SECONDS + 1) * 1000);
    expect(verifyPrintToken(token, PATH, later)).toBeNull();
    const justBefore = new Date(now.getTime() + (PRINT_TOKEN_TTL_SECONDS - 1) * 1000);
    expect(verifyPrintToken(token, PATH, justBefore)).not.toBeNull();
  });

  it("rejects a tampered payload, a wrong signature, garbage and nothing", () => {
    const token = createPrintToken(payload, now);
    const [encoded, signature] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...payload, tenantId: "tenant-2", exp: 9999999999 })).toString("base64url")}.${signature}`;
    expect(verifyPrintToken(forged, PATH, now)).toBeNull();
    expect(verifyPrintToken(`${encoded}.AAAA`, PATH, now)).toBeNull();
    expect(verifyPrintToken("not-a-token", PATH, now)).toBeNull();
    expect(verifyPrintToken(undefined, PATH, now)).toBeNull();
    expect(verifyPrintToken("", PATH, now)).toBeNull();
  });

  it("a token signed with another secret is rejected", () => {
    const token = createPrintToken(payload, now);
    process.env.AUTH_SECRET = "another-secret-another-secret-another-secret";
    expect(verifyPrintToken(token, PATH, now)).toBeNull();
    process.env.AUTH_SECRET = "test-secret-for-print-tokens-at-least-32-chars";
  });
});
