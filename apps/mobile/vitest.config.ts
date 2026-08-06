/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Node-environment tests for the mobile app's plain-TypeScript logic — the
 * query-cache mutations in `lib/` and the home-screen widget handler in
 * `widgets/`, not the React Native tree.
 *
 * There is deliberately no renderer here. Anything that draws needs a device or
 * a simulator, neither of which exists in CI, and pretending otherwise with a
 * jsdom shim would test a React Native that isn't the one that ships. What this
 * suite covers is the sequencing the eye *can't* check on a device anyway: the
 * order of a write, its optimistic cache patch, and the invalidate that follows.
 *
 * The widget handler is here for the same reason. It builds a description of a
 * tile; only Android turns that into pixels. But *whether* it builds one — for
 * which actions, out of which modules — is the whole bug surface, and it fails
 * silently on a device: a widget that doesn't draw looks like an empty cell.
 *
 * Modules that reach for native code (`./supabase`, `./widgets`,
 * `./location-queries`, `./query-client`, `react-native-android-widget`) are
 * mocked per-test rather than globally, so each test states exactly which native
 * seam it is standing in for.
 */
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: resolve(__dirname) + "/" }],
  },
  test: {
    environment: "node",
    globals: true,
    // `plugins/` is here for the same reason as `widgets/`: a config plugin is
    // plain Node that emits XML, and every way it can be wrong (a dropped
    // shortcut, a dead deep link) fails silently on the device rather than at
    // build time.
    include: [
      "lib/**/*.test.ts",
      "widgets/**/*.test.ts",
      "plugins/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**"],
  },
});
