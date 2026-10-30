import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["tests/**/*.test.ts"],
    // integration tests share one Postgres and one Redis
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
