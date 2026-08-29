// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  ...storybook.configs["flat/recommended"],
  {
    rules: {
      // Next 16's react-hooks preset promotes this React-Compiler rule to an
      // error. Across this codebase it fires on the deliberate, well-documented
      // pattern of syncing optimistic local state back from props after a
      // router.refresh (e.g. task-item, week-view, the draggable lists) — an
      // intentional choice, not a bug. Keep it visible as a warning instead of
      // failing the whole lint. The hook rules that genuinely matter
      // (rules-of-hooks, set-state-in-render, impure-during-render) stay errors.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
