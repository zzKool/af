import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          include: ["src/kernel/**/*.test.ts", "src/modules/**/*.test.ts"],
          exclude: ["src/kernel/{money,i18n,nav,stores,errors,guards}/**"],
          environment: "node",
          setupFiles: ["src/kernel/db/test-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "pure",
          include: ["src/kernel/{money,i18n,nav,stores,errors,guards}/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "client",
          include: ["src/**/*.test.tsx"],
          exclude: ["src/generated/**"],
          environment: "jsdom",
        },
      },
    ],
  },
});
