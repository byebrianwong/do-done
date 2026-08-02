import { afterEach, expect } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";

// Register jest-dom's matchers against *this* package's vitest, rather than
// importing "@testing-library/jest-dom/vitest".
//
// That entry point does its own bare `import { expect } from 'vitest'`. The
// repo has two majors installed — vitest 4 here, vitest 3 in packages/* — and
// jest-dom is not a direct dependent of either, so pnpm resolves its bare
// specifier to the v3 copy in the virtual store. Its expect.extend() then
// lands on an instance no test ever uses, and every toBeInTheDocument()
// assertion dies with "Invalid Chai property".
//
// The "/matchers" entry is runner-agnostic (no vitest import at all), so
// extending it here binds the matchers to the expect these tests actually run
// against. Keep it this way until packages/* and apps/web share one vitest.
expect.extend(jestDomMatchers);

// Components/libraries (and Tailwind responsive probing) sometimes read
// matchMedia, which jsdom doesn't implement. Provide an inert stub.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// Any Supabase code path that slips past the client alias still needs these
// to avoid throwing on missing config.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "placeholder-anon-key";

afterEach(() => {
  cleanup();
});
