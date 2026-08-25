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
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(rootDir, "src") },
  },
});
