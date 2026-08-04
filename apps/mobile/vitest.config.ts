/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Node-environment tests for the mobile app's plain-TypeScript logic — the
 * query-cache mutations in `lib/`, not the React Native tree.
 *
 * There is deliberately no renderer here. Anything that draws needs a device or
 * a simulator, neither of which exists in CI, and pretending otherwise with a
 * jsdom shim would test a React Native that isn't the one that ships. What this
 * suite covers is the sequencing the eye *can't* check on a device anyway: the
 * order of a write, its optimistic cache patch, and the invalidate that follows.
 *
 * Modules that reach for native code (`./supabase`, `./widgets`,
 * `./location-queries`, `./query-client`) are mocked per-test rather than
 * globally, so each test states exactly which native seam it is standing in for.
 */
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: resolve(__dirname) + "/" }],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["lib/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
  },
});
