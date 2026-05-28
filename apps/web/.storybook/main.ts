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
  async viteFinal(viteConfig) {
    const here = dirname(fileURLToPath(import.meta.url));
    viteConfig.resolve = viteConfig.resolve ?? {};
    viteConfig.resolve.alias = {
      ...(viteConfig.resolve.alias as Record<string, string> | undefined),
      "@/lib/supabase/client": resolve(here, "./supabase-client.mock.ts"),
    };
    return viteConfig;
  },
};
export default config;