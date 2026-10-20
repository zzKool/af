import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: {
    service: "defterfab",
    version: process.env.npm_package_version || "unknown",
    environment: process.env.NODE_ENV,
  },
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino-pretty" },
  }),
});

export { logger };
