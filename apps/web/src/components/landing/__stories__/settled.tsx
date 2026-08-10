import { useEffect, useState } from "react";
import type { Decorator } from "@storybook/nextjs-vite";

/**
 * Renders a marketing surface in its **settled** state, so Chromatic has
 * something deterministic to compare.
 *
 * The landing page is the most animated thing DoDone ships, and every piece of
 * that motion is a source of snapshot flake: the hero's row ticks itself off on
 * a 7s loop, the quick-add bar types a sentence out over ~2.8s and then wipes
 * it, the caret blinks, the chips fly in, the aurora drifts, and each section
 * fades up from `opacity: 0` when an IntersectionObserver says it arrived. A
 * snapshot taken at an arbitrary instant catches those mid-flight, and reports
 * the difference as a visual change every single build.
 *
 * Rather than invent a resting state, this puts the page on the one the app
 * *already ships* for anyone with "reduce motion" set. That path is real,
 * user-visible, and worth having under test in its own right — so the baseline
 * is a state the product genuinely produces, not a Storybook-only fiction.
 *
 * It takes both halves, because the app gates motion two different ways:
 *
 *  - **CSS** — mirrors the `prefers-reduced-motion: reduce` block in
 *    `globals.css`. A `<style>` tag rather than a media query because a story
 *    cannot ask the browser to pretend. **These rules must track that block**;
 *    they are a copy of it, and the only copy.
 *  - **JS** — `QuickAddDemo` asks `matchMedia` directly and skips the
 *    typewriter when it answers yes, which no stylesheet can reach. The patch
 *    is installed during render (before the component's own effect runs) and
 *    removed on unmount, so it cannot leak into the next story in the iframe.
 *
 * `IntersectionObserver` is stubbed for a third reason: both animated pieces
 * gate themselves on being on screen, and in a full-page story the quick-add
 * section sits far below the fold, so it renders as an empty bar that has
 * never typed anything. That is not merely a worse picture — it is *unstable*,
 * because Chromatic captures the full page height and the observer may or may
 * not fire as it does. Reporting everything as intersecting settles it either
 * way, and yields the state a reader who scrolled there would see.
 *
 * Deliberately *not* relying on Chromatic pausing CSS animations for us. It
 * does, but that only reaches keyframes — the reveal is a transition and the
 * typewriter is a `setTimeout` chain, and neither would be covered.
 */
const SETTLED_CSS = `
  .dd-reveal {
    opacity: 1 !important;
    transform: none !important;
    transition: none !important;
  }
  .dd-aurora-a,
  .dd-aurora-b,
  .dd-tick-fill,
  .dd-tick-ring,
  .dd-tick-title,
  .dd-caret,
  .dd-chip-in {
    animation: none !important;
  }
  .dd-chip-in { opacity: 1 !important; }
  .dd-tick-fill { transform: scale(1) !important; }
`;

const REDUCED = "prefers-reduced-motion";

export const withSettledMotion: Decorator = (Story) => {
  // useState's initialiser runs during the first render — early enough that the
  // component's own `matchMedia` check, which happens in an effect, sees the
  // patched version.
  const [real] = useState(() => {
    const originalMatchMedia = window.matchMedia;
    const originalObserver = window.IntersectionObserver;

    window.matchMedia = ((query: string) =>
      query.includes(REDUCED)
        ? {
            matches: true,
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent: () => false,
          }
        : originalMatchMedia.call(window, query)) as typeof window.matchMedia;

    // Everything is on screen, immediately and forever. `observe` reports
    // synchronously rather than on a task, so a component that starts its work
    // on the first intersection has already started by the time anything can
    // photograph it.
    class AlwaysIntersecting {
      constructor(private readonly cb: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.cb(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        );
      }
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    window.IntersectionObserver =
      AlwaysIntersecting as unknown as typeof window.IntersectionObserver;

    return { originalMatchMedia, originalObserver };
  });

  useEffect(() => () => {
    window.matchMedia = real.originalMatchMedia;
    window.IntersectionObserver = real.originalObserver;
  }, [real]);

  return (
    <>
      <style>{SETTLED_CSS}</style>
      <Story />
    </>
  );
};
