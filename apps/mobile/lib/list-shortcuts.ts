/**
 * Keeping the launcher's list shortcuts in step with the user's lists.
 *
 * `list-shortcut-plan.ts` decides what the shortcuts should be;
 * `modules/list-shortcuts` writes them. This is the part in between: reading
 * the lists, choosing when to run, and refusing to run on a read it cannot
 * trust.
 *
 * The shape is `lib/widgets.ts`'s, deliberately — Android only, no-op in Expo
 * Go, lazily required so nothing native is touched on a platform that has none
 * of it, debounced so a burst of writes collapses into one launcher update.
 *
 * **This needs a fresh `eas build`.** It is a new native module, so it does not
 * arrive over OTA; an installed build simply has no `DoDoneListShortcuts` and
 * every call here resolves to nothing.
 */
import { Platform } from 'react-native';
import { splitProjects } from '@do-done/shared';
import type { Project } from '@do-done/shared';

import { IS_EXPO_GO } from '@/lib/runtime';
import { getProjectsApi } from '@/lib/supabase';
import { loadResume } from '@/lib/tab-resume';
import {
  DELETED_LIST_MESSAGE,
  LIST_SHORTCUT_PREFIX,
  listShortcutFor,
  planListShortcuts,
} from '@/lib/list-shortcut-plan';
import type { ListShortcutsNativeModule } from '@/modules/list-shortcuts';

const DEBOUNCE_MS = 800;
let pending: ReturnType<typeof setTimeout> | null = null;

/**
 * The native module, or null everywhere it does not exist: iOS, Expo Go, and
 * any Android build made before this module was added. Required lazily for the
 * reason `lib/widgets.ts` does it — the module file calls into
 * expo-modules-core at import time, and nothing should pay for that on a
 * headless widget start that will never touch a shortcut.
 */
function nativeModule(): ListShortcutsNativeModule | null {
  if (Platform.OS !== 'android' || IS_EXPO_GO) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/modules/list-shortcuts') as typeof import('@/modules/list-shortcuts');
    return mod.default;
  } catch {
    return null;
  }
}

/**
 * Re-write the launcher's list shortcuts from the current lists.
 *
 * **A failed read is not an empty account.** `ProjectsApi.list()` sets `data`
 * to `[]` when it fails, and acting on that would disable every pinned list
 * icon on the home screen over a dropped connection — the same failure the web
 * app's `lib/read-result.ts` exists to prevent one layer up. So the prune is
 * gated on the read having actually succeeded, and a signed-out app only
 * clears the menu entry.
 *
 * Fire-and-forget: this never throws and never blocks a caller. A launcher
 * shortcut that did not update is worth nothing next to a write that failed
 * because of it.
 */
export async function syncListShortcuts(): Promise<void> {
  const native = nativeModule();
  if (!native) return;

  try {
    const api = await getProjectsApi();
    const { data, error } = await api.list();

    if (error) {
      // Drop the menu entry — it may point at a list this account cannot see —
      // but leave every pinned icon alone. See above.
      await native.sync([], null, LIST_SHORTCUT_PREFIX, DELETED_LIST_MESSAGE, false);
      return;
    }

    const lists = splitProjects(data ?? []).lists;
    const lastListId = await loadResume('lists');
    const plan = planListShortcuts({ lists, lastListId });
    await native.sync(
      plan.shortcuts,
      plan.dynamicId,
      LIST_SHORTCUT_PREFIX,
      DELETED_LIST_MESSAGE,
      true
    );
  } catch {
    // Native module missing, or the launcher refused. Nothing to report: the
    // user did not ask for this and the app is unaffected.
  }
}

/**
 * Debounced `syncListShortcuts`. Called from `invalidateLists()` and from the
 * two screens that move the remembered list, so a rename, a delete and a tab
 * resume all land on the launcher without any of them waiting for it.
 */
export function scheduleListShortcutSync(): void {
  if (Platform.OS !== 'android' || IS_EXPO_GO) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void syncListShortcuts();
  }, DEBOUNCE_MS);
}

/** Clear the long-press menu entry, leaving pinned icons alone. Sign-out. */
export async function clearListShortcutMenuEntry(): Promise<void> {
  const native = nativeModule();
  if (!native) return;
  try {
    await native.sync([], null, LIST_SHORTCUT_PREFIX, DELETED_LIST_MESSAGE, false);
  } catch {
    // As above.
  }
}

export type PinResult =
  /** The system's "Add to home screen" dialog was raised. */
  | 'requested'
  /** This launcher cannot pin, or there is no native module to ask. */
  | 'unsupported'
  /** The request was refused outright. */
  | 'failed';

/**
 * Ask the system to put one list on the home screen.
 *
 * `'requested'` is as much as anyone can know: Android shows its own dialog and
 * never reports what the user chose. So the caller must say nothing that claims
 * the icon was added — the dialog is the feedback, and inventing a "Added to
 * home screen" toast beside it would be wrong half the time.
 */
export async function pinListShortcut(
  list: Pick<Project, 'id' | 'name' | 'color'>
): Promise<PinResult> {
  const native = nativeModule();
  if (!native) return 'unsupported';
  try {
    if (!(await native.isPinSupported())) return 'unsupported';
    const ok = await native.requestPin(listShortcutFor(list));
    return ok ? 'requested' : 'failed';
  } catch {
    return 'failed';
  }
}
