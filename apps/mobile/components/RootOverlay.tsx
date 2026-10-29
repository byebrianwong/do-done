/**
 * Draw a sheet in the app's root view instead of in a `Modal`, on Android.
 *
 * On Android, React Native 0.81 draws a `Modal` in a window of its own. With
 * edge-to-edge on, that window ignores `adjustResize`, and Reanimated's
 * `useAnimatedKeyboard` listens on the activity's window only. So nothing in a
 * `Modal` can see the keyboard, and a sheet with text fields low down types
 * behind it. `ProjectFormSheet` solved this with a host of its own. This is the
 * same idea for sheets that are rendered by a screen and cannot move: the
 * screen renders `<RootPortal>` where it used to render `<Modal>`, and the
 * content is drawn by `RootOverlayHost`, mounted once in `app/_layout.tsx`
 * after the navigator.
 *
 * - **The content keeps its owner's hooks.** Only the elements travel. State,
 *   shared values and gestures are created by the component that renders the
 *   portal, so its props API does not change and no call site moves.
 * - **Context does not travel.** The content sees the providers above the host
 *   (the query client, the undo toast, gesture handler), not the ones around
 *   the portal. Nothing that uses this needs a screen-level provider.
 * - **Later portals draw on top.** A sheet opened from inside another sheet is
 *   registered after it, and an update keeps an entry's place. See
 *   `lib/root-overlay-store.ts`.
 * - **Android only.** On iOS a `transparentModal` route (quick-add, a task
 *   link) is a separately presented view controller, so anything drawn in the
 *   root view would be behind it. iOS keeps `Modal`, where the keyboard is not
 *   a problem: its notifications are app-wide.
 *
 * A portal does not close itself on Android's back button, because the owner
 * decides what back means (the editor asks first if an edit has not saved).
 * Owners register a `BackHandler` while they are shown.
 */

import React, { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createOverlayStore } from '@/lib/root-overlay-store';

/**
 * What an entry's root sets as its zIndex. `DevBanner` and `PrPreviewBanner`
 * are siblings of the host with zIndex 9999, and a sheet has to cover them,
 * as a `Modal`'s window did. Android `elevation` still beats zIndex, so the
 * undo toast (elevation 8) draws over a sheet here, where a `Modal` hid it.
 */
export const OVERLAY_Z_INDEX = 10000;

const store = createOverlayStore<ReactNode>();
let nextId = 1;

/**
 * Render `children` in the root overlay for as long as this is mounted.
 *
 * Re-registers on every render so the content tracks its owner's props. The
 * host then re-renders once, in the same commit, which is what a `Modal`'s
 * children cost too.
 */
export function RootPortal({ children }: { children: ReactNode }) {
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = nextId++;
  const id = idRef.current;

  useLayoutEffect(() => {
    store.set(id, children);
  });
  useLayoutEffect(() => () => store.remove(id), [id]);

  return null;
}

/** Mounted once, after the root navigator. Draws nothing while empty. */
export function RootOverlayHost() {
  const entries = useSyncExternalStore(store.subscribe, store.entries);
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map(([id, content]) => (
        // A fragment rather than a wrapping View, so the content's own root is
        // the view that gets removed and its `exiting` animation runs. Each
        // entry therefore positions itself, usually over the whole screen.
        <React.Fragment key={id}>{content}</React.Fragment>
      ))}
    </>
  );
}
