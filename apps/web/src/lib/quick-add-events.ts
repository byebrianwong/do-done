import type { QuickAddSeed } from "./quick-add";

/**
 * Window event that opens the universal quick-add modal. Dispatched by the
 * sidebar button, the floating action button, the command palette, and any
 * other surface that wants a global "new task" entry point. An optional `seed`
 * in the event detail pre-fills the modal with a section's context.
 *
 * Lives in its own module so the palette and the modal can both import it
 * without creating an import cycle.
 */
export const OPEN_QUICK_ADD_EVENT = "do-done:open-quick-add";

export interface OpenQuickAddDetail {
  seed?: QuickAddSeed;
}

/** Convenience dispatcher so callers don't hand-roll the CustomEvent. */
export function openQuickAdd(seed?: QuickAddSeed) {
  window.dispatchEvent(
    new CustomEvent<OpenQuickAddDetail>(OPEN_QUICK_ADD_EVENT, {
      detail: { seed },
    })
  );
}
