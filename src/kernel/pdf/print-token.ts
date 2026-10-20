// Print tokens — how the PDF renderer (Chromium, inside the container) is allowed to open a
// `/print/...` page without a session. HMAC-signed with AUTH_SECRET, bound to one path, short-lived.
// Minted by kernel/pdf right before a render; verified by the print page via requirePrintCaller().
import { createHmac, timingSafeEqual } from "node:crypto";

export interface PrintTokenPayload {
  tenantId: string;
  userId: string;
  /** The exact path the token opens, e.g. `/print/invoice/<id>`. */
  path: string;
  /** Unix seconds. */
  exp: number;
}

export const PRINT_TOKEN_TTL_SECONDS = 120;
export const PRINT_TOKEN_PARAM = "pt";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is required to sign print tokens");
  return s;
}

function sign(encodedPayload: string, key: string): string {
  return createHmac("sha256", key).update(encodedPayload).digest("base64url");
}

export function createPrintToken(
  payload: Omit<PrintTokenPayload, "exp">,
  now: Date = new Date(),
  ttlSeconds: number = PRINT_TOKEN_TTL_SECONDS,
): string {
  const full: PrintTokenPayload = {
    ...payload,
    exp: Math.floor(now.getTime() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${encoded}.${sign(encoded, secret())}`;
}

/** The payload when the token is well-formed, signed by us, unexpired and minted for `path`; else null. */
export function verifyPrintToken(
  token: string | null | undefined,
  path: string,
  now: Date = new Date(),
): PrintTokenPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(encoded, secret());
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: PrintTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload.tenantId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.path !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (payload.path !== path) return null;
  if (payload.exp <= Math.floor(now.getTime() / 1000)) return null;
  return payload;
}
