import { defineConfig } from "vitest/config";
import path from "node:path";

const rootDir = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one Postgres database, so they must not run in
    // parallel against each other.
    fileParallelism: false,
    // Each test file opens its own pooled connection; connecting under load can
    // exceed the 10s default.
    hookTimeout: 30000,
    testTimeout: 30000,
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(rootDir, "src") },
  },
});
