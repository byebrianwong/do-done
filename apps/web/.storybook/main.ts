import type { StorybookConfig } from '@storybook/nextjs-vite';

import { dirname, resolve } from "path"

import { fileURLToPath } from "url"

/**
* This function is used to resolve the absolute path of a package.
* It is needed in projects that use Yarn PnP or are set up within a monorepo.
*/
function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)))
}
const config: StorybookConfig = {
  "stories": [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [
    getAbsolutePath('@chromatic-com/storybook'),
    getAbsolutePath('@storybook/addon-vitest'),
    getAbsolutePath('@storybook/addon-a11y'),
    getAbsolutePath('@storybook/addon-docs'),
    getAbsolutePath('@storybook/addon-onboarding')
  ],
  "framework": getAbsolutePath('@storybook/nextjs-vite'),
  "staticDirs": [
    "../public"
  ],
  // Swap the real Supabase client for a deep-Proxy stub so stories that
  // mount components calling `createClientSupabase()` don't crash when
  // Storybook is built in CI without NEXT_PUBLIC_SUPABASE_* env vars.
  //
  // Matched on the RESOLVED file, not the import specifier: an alias keyed on
  // "@/lib/supabase/client" misses `./client`, which is how the modules living
  // next to it (user-prefs-client, tasks-client, …) import it — so the real
  // client leaked into stories and threw "your project's URL and API key are
  // required" the moment one of them wrote anything.
  async viteFinal(viteConfig) {
    const here = dirname(fileURLToPath(import.meta.url));
    const stub = resolve(here, "./supabase-client.mock.ts");
    viteConfig.plugins = viteConfig.plugins ?? [];
    viteConfig.plugins.push({
      name: "do-done:stub-supabase-browser-client",
      enforce: "pre",
      async resolveId(source, importer, options) {
        if (!importer || source.includes("supabase-client.mock")) return null;
        const resolved = await this.resolve(source, importer, {
          ...options,
          skipSelf: true,
        });
        if (!resolved) return null;
        return /[\\/]lib[\\/]supabase[\\/]client\.tsx?$/.test(resolved.id)
          ? stub
          : null;
      },
    });
    return viteConfig;
  },
};
export default config;