"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getDemoState,
  hydrateDemoStore,
  subscribeDemoStore,
  type DemoState,
} from "./store";

export interface DemoData extends DemoState {
  /**
   * False until the saved sandbox has been adopted on the client.
   *
   * The seed is dated from the *reader's* calendar day, and the server's day
   * is UTC — so anything date-shaped rendered during SSR is a hydration
   * mismatch waiting to happen, on top of showing a stranger's pristine seed
   * to someone who already moved things around. Screens hold a placeholder
   * for the one tick this takes rather than paint an answer they'd have to
   * take back.
   */
  ready: boolean;
}

/** The sandbox's data, re-rendering the caller on every write to it. */
export function useDemoData(): DemoData {
  const state = useSyncExternalStore(
    subscribeDemoStore,
    getDemoState,
    getDemoState
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    hydrateDemoStore();
    setReady(true);
  }, []);
  return { ...state, ready };
}
