// Registers jest-dom's matchers on vitest's expect.
//
// This entry point resolves `vitest` itself, so it only works while the whole
// workspace is on one vitest major — jest-dom is a direct dependent of no
// package here, so pnpm picks the copy in its own resolution path. When
// apps/web was on 4.x and packages/* on 3.x, it extended the v3 copy that no
// test ran against, and every toBeInTheDocument() died with "Invalid Chai
// property". Keep the versions aligned (see the root CLAUDE.md) rather than
// working around it here.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

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
