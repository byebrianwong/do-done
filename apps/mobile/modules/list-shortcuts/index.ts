/**
 * JS face of the `list-shortcuts` local Expo module (Android only).
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: this resolves
 * to null on iOS, in Expo Go, and in any build made before the module existed,
 * instead of throwing at import time. Every caller has to handle null anyway —
 * launcher shortcuts are an Android feature — so a throw would buy nothing and
 * would take the whole bundle down where it is imported.
 */
import { requireOptionalNativeModule } from 'expo';

/** One list's launcher shortcut. Built by `lib/list-shortcut-plan.ts`. */
export type NativeListShortcut = {
  /** The *shortcut* id, prefixed — not the list's uuid. */
  id: string;
  /** What the launcher prints under the icon. Short; Android truncates. */
  shortLabel: string;
  /** What it prints in the long-press menu, where there is more room. */
  longLabel: string;
  /** `dodone://lists/<id>`. */
  url: string;
  /** `#rrggbb`. Drawn as the icon's background. */
  color: string;
};

export type ListShortcutsNativeModule = {
  /** False on launchers that cannot pin — a few still cannot. */
  isPinSupported(): Promise<boolean>;
  /**
   * Ask the system to pin one list. The boolean reports that the request was
   * issued, never that the user accepted it: the system's own dialog does the
   * asking and tells us nothing afterwards.
   */
  requestPin(shortcut: NativeListShortcut): Promise<boolean>;
  /**
   * Bring the launcher in line with `shortcuts`.
   *
   * `prune` must be false whenever the caller could not read the user's lists
   * for certain. An empty set with `prune` on means "this account has no
   * lists", and disables every pinned list icon on the home screen — which is
   * the wrong thing to conclude from a dropped connection.
   */
  sync(
    shortcuts: NativeListShortcut[],
    dynamicId: string | null,
    prefix: string,
    disabledMessage: string,
    prune: boolean
  ): Promise<void>;
};

// Must match `Name(...)` in ListShortcutsModule.kt. Asserted in module.test.ts.
export default requireOptionalNativeModule<ListShortcutsNativeModule>(
  'DoDoneListShortcuts'
);
