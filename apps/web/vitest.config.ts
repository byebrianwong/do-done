/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Standalone Vitest config for jsdom component/unit tests. This is separate
// from the Storybook/Chromatic visual-test pipeline — it runs the
// `src/**/*.test.tsx` suite that proves the mobile-web responsive behaviour.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Workspace packages carry their own `react` devDependency, so a hook
    // imported from `@do-done/api-client` source resolves a *second* React
    // copy and renders with a null dispatcher ("Cannot read properties of
    // null (reading 'useRef')"). Pin every import to this app's copy.
    dedupe: ["react", "react-dom"],
    alias: [
      // Swap the real Supabase browser client (reads NEXT_PUBLIC_* at call
      // time) for the same deep-Proxy stub Storybook uses, so components that
      // construct a client mount without credentials. Must come before the
      // generic "@/" alias so the more specific path wins.
      {
        find: "@/lib/supabase/client",
        replacement: resolve(__dirname, ".storybook/supabase-client.mock.ts"),
      },
      { find: /^@\//, replacement: resolve(__dirname, "src") + "/" },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    // We don't process Tailwind in tests — class strings are asserted as text.
    css: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/*.stories.*", "**/dist/**"],
  },
});
