/**
 * The phone half of the Wear OS bridge: put a snapshot on the Data Layer, and
 * hear about a watch asking for a fresh one.
 *
 * Android-only, and absent in Expo Go — the module ships native code that is
 * not in the Go runtime. Every export here is safe to call anywhere: the native
 * module is looked up lazily and a missing one is a no-op returning `false`,
 * the same shape `lib/widgets.ts` uses.
 */

import { NativeModule, requireNativeModule } from 'expo';
import { Platform } from 'react-native';

/**
 * A watch asking for a fresh snapshot does not come through here. It arrives as
 * a headless JS task (`DoDoneWearSync`, registered in `index.js`), because the
 * case it exists for is the phone's app being dead — there is no listener
 * mounted to receive an event.
 */
declare class DoDoneWearNativeModule extends NativeModule {
  /**
   * Write the snapshot and the session to the Data Layer.
   *
   * Both are strings rather than objects: the payload is built and validated by
   * `lib/wear-snapshot.ts` in JS, and re-encoding it across the bridge as a map
   * would give the native side a second opinion about its shape.
   *
   * A put with no watch paired is not a failure: the item is held on the phone
   * and delivered when a node appears. So this rejecting means the write itself
   * failed, and the JS wrapper below turns that into `false`.
   */
  syncToWatch(snapshotJson: string, sessionJson: string): Promise<boolean>;
  /** Drop both data items. Called on sign-out. */
  clearWatch(): Promise<boolean>;
  /** True when at least one connected node has the DoDone watch app. */
  hasWatchApp(): Promise<boolean>;
}

let cached: DoDoneWearNativeModule | null | undefined;

function nativeModule(): DoDoneWearNativeModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'android') {
    cached = null;
    return cached;
  }
  try {
    cached = requireNativeModule<DoDoneWearNativeModule>('DoDoneWear');
  } catch {
    // Expo Go, or a build made before this module existed.
    cached = null;
  }
  return cached;
}

export async function syncToWatch(
  snapshotJson: string,
  sessionJson: string
): Promise<boolean> {
  const mod = nativeModule();
  if (!mod) return false;
  try {
    return await mod.syncToWatch(snapshotJson, sessionJson);
  } catch {
    return false;
  }
}

export async function clearWatch(): Promise<boolean> {
  const mod = nativeModule();
  if (!mod) return false;
  try {
    return await mod.clearWatch();
  } catch {
    return false;
  }
}

export async function hasWatchApp(): Promise<boolean> {
  const mod = nativeModule();
  if (!mod) return false;
  try {
    return await mod.hasWatchApp();
  } catch {
    return false;
  }
}

