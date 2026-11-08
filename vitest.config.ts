import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vendored upstream tests import from "vite-plus/test"; map it to plain vitest.
export default defineConfig({
  resolve: {
    alias: [{ find: /^vite-plus\/test$/, replacement: "vitest" }],
  },
  test: {
    include: [
      "vendor/**/*.test.ts",
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "tools/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Known upstream failures unrelated to game rules (see vendor/UPSTREAM.md "Known test failures").
      "vendor/cyberpunk-ai-runner/tests/runner.test.ts",
      "vendor/protocol/src/native.test.ts",
      "vendor/cyberpunk-cards/tests/canonical-authorship.test.ts",
    ],
    pool: "threads",
    testTimeout: 60_000,
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
});
