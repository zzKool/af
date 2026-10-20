import { expect, test } from "@playwright/test";

// /api/health (docs/deployment.md): what the container healthcheck, the proxy and Azure's probes call —
// unauthenticated, a database round trip, the jobs state, the build's version.
test("the health endpoint answers without a session", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.status()).toBe(200);
  expect(r.headers()["cache-control"]).toContain("no-store");
  const body = await r.json();
  expect(body).toMatchObject({ status: "ok", db: "ok", jobs: "enabled" });
  expect(typeof body.dbLatencyMs).toBe("number");
  expect(typeof body.uptimeSeconds).toBe("number");
});
