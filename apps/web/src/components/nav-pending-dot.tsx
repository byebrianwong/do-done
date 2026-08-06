"use client";

import { useLinkStatus } from "next/link";

/**
 * A small pulsing dot on the nav link the user just clicked, shown only while
 * that navigation is still blocked.
 *
 * It is the third and last layer of click feedback, and only ever fires when the
 * first two haven't:
 *
 *   1. `active:` styling on the row — instant, CSS-only, fires on pointer-down.
 *   2. The active pill moving, the moment the transition commits. With a
 *      `loading.tsx` on every route (which is what allows the shells to
 *      prefetch) that is normally the same frame as the click.
 *   3. This — for when the shell hasn't prefetched yet and the click really is
 *      waiting on the network.
 *
 * Must be rendered *inside* a `<Link>`: `useLinkStatus` reads the status off the
 * nearest Link ancestor. It returns `{ pending: false }` outside one, so a
 * misplacement is silent — hence this being its own component with one job.
 *
 * The element is always mounted at a fixed size and toggled through
 * `data-pending`; showing it by mounting it would reflow the row mid-click,
 * which is the opposite of what it's for.
 */
export function NavPendingDot() {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden
      data-pending={pending}
      className="dd-link-pending ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-current"
    />
  );
}
