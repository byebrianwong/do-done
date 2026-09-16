/**
 * Which list or project each List widget on the home screen is pinned to.
 *
 * The other four widgets answer a question that has one answer per user —
 * "what is today", "what is next" — so they need no configuration. This one
 * does not: "everything in a particular list" is not a question until you say
 * *which* list, and two of these widgets side by side are meant to show two
 * different ones.
 *
 * So the pick is stored against the widget's own `widgetId`, which the launcher
 * hands to every render and every click. `react-native-android-widget` has no
 * configuration activity, and adding one would mean native code and a fresh
 * build for a question the widget can perfectly well ask in its own cell: an
 * unconfigured widget draws the picker, and a tap on a row is the answer.
 *
 * AsyncStorage rather than a column on `user_preferences`, for two reasons. A
 * widget id belongs to this launcher on this device — it means nothing to the
 * laptop, and syncing it would make two phones fight over one row. And the
 * store has to be readable in a cold headless widget update, where the
 * Supabase session is already being read from exactly here.
 *
 * `targetDecision` is pure so the node suite covers it. This is the kind of
 * rule that fails silently on a device — a widget that re-asks a question you
 * already answered, or one stranded on a list you deleted on the laptop.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'widget:list-target:';

export function targetKey(widgetId: number): string {
  return `${KEY_PREFIX}${widgetId}`;
}

/** The widget id a stored key belongs to, or null if the key isn't ours. */
export function widgetIdFromKey(key: string): number | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const id = Number(key.slice(KEY_PREFIX.length));
  return Number.isInteger(id) ? id : null;
}

export type TargetDecision =
  /** Draw the picker: nothing is pinned, or what was is gone. */
  | { action: 'pick' }
  /** Draw this list or project. */
  | { action: 'show'; id: string };

/**
 * What a List widget should draw, given what it remembers and what exists.
 *
 * Three rules:
 *
 * - **A pinned target that no longer exists falls back to the picker**, the
 *   same way the Lists tab's resume memory falls back to its index. A list
 *   deleted on the laptop must not strand the phone on a widget that can only
 *   say "not found" — and the widget is the one surface with no back button.
 * - **It never expires.** A month later the widget still shows Groceries,
 *   because a month later that is still the list you keep. A time limit would
 *   only make the home screen unpredictable.
 * - **One candidate and nothing pinned picks itself.** A picker offering a
 *   single row is a question with one answer, and asking it costs the user a
 *   tap to learn nothing. With none, or with more than one, it asks.
 */
export function targetDecision(input: {
  stored: string | null;
  known: string[];
}): TargetDecision {
  const { stored, known } = input;
  if (stored && known.includes(stored)) return { action: 'show', id: stored };
  if (!stored && known.length === 1) return { action: 'show', id: known[0] };
  return { action: 'pick' };
}

export async function readTarget(widgetId: number): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(targetKey(widgetId));
  } catch {
    // An unreadable store means "not pinned yet", which draws the picker. That
    // is a worse answer than the right list and a much better one than a
    // widget that fails to draw at all.
    return null;
  }
}

export async function writeTarget(
  widgetId: number,
  projectId: string
): Promise<void> {
  try {
    await AsyncStorage.setItem(targetKey(widgetId), projectId);
  } catch {
    // Best-effort: the render below this call still shows the list that was
    // just picked, so the tap is not lost until the next update.
  }
}

export async function forgetTarget(widgetId: number): Promise<void> {
  try {
    await AsyncStorage.removeItem(targetKey(widgetId));
  } catch {
    // ignore
  }
}
