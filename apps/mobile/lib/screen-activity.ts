/**
 * Whether a screen is on view, for deciding which list queries stay subscribed.
 *
 * Every tab screen stays mounted once visited, and so does every screen under
 * the top of a stack. Their queries stayed subscribed, so `invalidateTasks()`
 * after a tick on Today refetched All (500 rows), Inbox, Lists and any project
 * that had been opened, and re-rendered each of those screens when the answers
 * arrived. A screen's list queries now pass `subscribed: useScreenActive()`.
 *
 * What an unsubscribed query still does, and why nothing else had to change:
 *
 * - **Its cache stays put.** The optimistic sweeps in `task-queries.ts` write to
 *   it like any other, and the persisted snapshot includes it.
 * - **An invalidate marks it stale without refetching it.** TanStack refetches
 *   only active queries by default. When the screen comes back, the query
 *   subscribes again and refetches because it is stale, before the user has
 *   read anything on it.
 * - **Other observers are unaffected.** The Tasks tab badge reads
 *   `useInboxTasks` from the tab layout, which is not a screen and passes no
 *   option, so the inbox stays active for it.
 *
 * **A screen under a transparent modal still counts as on view.** The quick-add
 * composer and the deep-linked task editor (`task/[id]`) are root-stack screens
 * drawn over the list, so React Navigation blurs the list beneath them. Going
 * by focus alone would unsubscribe Today the moment the composer opened, and
 * the task just typed would only be fetched once the composer had closed. That
 * is the delay `app/quick-add.tsx` invalidates before closing to avoid.
 */
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';

/** Root-stack screens drawn over the list beneath them, not instead of it. */
export const OVERLAY_ROUTE_NAMES: ReadonlySet<string> = new Set([
  'quick-add',
  'task/[id]',
]);

/** The parts of a React Navigation state this reads. */
export interface NavStateLike {
  index?: number;
  routes: readonly { key: string; name: string; state?: NavStateLike }[];
}

/**
 * Whether the route with `routeKey` is on screen, given the root state.
 *
 * Follows the focused route down from the root. At each level a focused
 * overlay is stepped past to the route under it, because that one is still
 * drawn. A route not on that path is hidden: another tab, or a screen with
 * another screen pushed over it.
 */
export function isRouteVisible(
  root: NavStateLike | undefined,
  routeKey: string
): boolean {
  let level = root;
  while (level && level.routes.length > 0) {
    let i = level.index ?? level.routes.length - 1;
    while (i > 0 && OVERLAY_ROUTE_NAMES.has(level.routes[i]?.name ?? '')) i--;
    const route = level.routes[i];
    if (!route) return false;
    if (route.key === routeKey) return true;
    level = route.state;
  }
  return false;
}

/**
 * True while the calling screen is on view.
 *
 * `useIsFocused` re-renders the screen on every focus change, which is also
 * every moment the answer can change. Only when it reports a blur is the root
 * state read, to tell an overlay from a real departure. That read does not
 * subscribe, so a hidden screen is not re-rendered by navigation elsewhere.
 */
export function useScreenActive(): boolean {
  const focused = useIsFocused();
  const navigation = useNavigation();
  const route = useRoute();
  if (focused) return true;
  let root = navigation;
  for (let parent = root.getParent(); parent; parent = parent.getParent()) {
    root = parent;
  }
  return isRouteVisible(root.getState() as NavStateLike | undefined, route.key);
}
