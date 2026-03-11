import pino from "pino";
import { describe, expect, it } from "vitest";

function createTestLogger(level = "debug") {
  const lines: string[] = [];
  const dest = {
    write(msg: string) {
      lines.push(msg);
    },
  };
  const log = pino(
    {
      level,
      base: {
        service: "defterfab",
        version: "test",
        environment: "test",
      },
    },
    dest,
  );
  return { log, lines };
}

describe("logger", () => {
  it("produces structured JSON with expected fields", () => {
    const { log, lines } = createTestLogger();
    log.info("test message");

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      level: 30, // info
      msg: "test message",
      service: "defterfab",
      version: "test",
      environment: "test",
    });
    expect(entry.time).toBeDefined();
  });

  it("child logger inherits base bindings and adds request bindings", () => {
    const { log, lines } = createTestLogger();
    const child = log.child({
      userId: "user-1",
      tenantId: "tenant-1",
      requestId: "req-1",
    });
    child.info("child message");

    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      service: "defterfab",
      userId: "user-1",
      tenantId: "tenant-1",
      requestId: "req-1",
      msg: "child message",
    });
  });

  it("filters log levels correctly (debug suppressed when level is info)", () => {
    const { log, lines } = createTestLogger("info");
    log.debug("should be suppressed");
    log.info("should appear");

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.msg).toBe("should appear");
  });

  it("logs error level with err serializer", () => {
    const { log, lines } = createTestLogger();
    const error = new Error("test error");
    log.error({ err: error }, "something failed");

    const entry = JSON.parse(lines[0]);
    expect(entry.level).toBe(50); // error
    expect(entry.err).toBeDefined();
    expect(entry.err.message).toBe("test error");
    expect(entry.err.type).toBe("Error");
  });
});
