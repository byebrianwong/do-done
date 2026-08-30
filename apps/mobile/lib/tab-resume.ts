/**
 * What the Lists and Projects tabs open on.
 *
 * A tab that always opens its index costs three taps to reach the grocery list
 * you use every week — twice, because nothing is remembered. So each of these
 * two tabs remembers the last screen you saw inside it and opens there, and
 * re-tapping the tab pops back to the index. Getting out is never more than one
 * tap, which is what makes remembering indefinitely safe.
 *
 * **The memory is the last screen, not the last detail.** Backing out to the
 * index is itself a visit, so it clears the memory and the next tap lands on
 * the index. That is why the index screen writes `null` on focus rather than
 * leaving whatever was there.
 *
 * `resumeDecision` is pure so the node suite can cover it — this is exactly the
 * kind of rule that fails silently on a device (a tab that opens on the wrong
 * screen, or one that navigates in a loop), and `apps/mobile` has no renderer.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ResumeSection = 'lists' | 'projects';

const KEY: Record<ResumeSection, string> = {
  lists: 'nav:lists:last',
  projects: 'nav:projects:last',
};

export type ResumeAction =
  /** Ids haven't loaded yet — do nothing and look again when they have. */
  | { action: 'wait' }
  /** Open the remembered screen. */
  | { action: 'open'; id: string }
  /** Drop the memory: the index is where the user is now. */
  | { action: 'forget' }
  /** Nothing remembered and nothing to clear. */
  | { action: 'stay' };

/**
 * What a section's index screen should do when it gains focus.
 *
 * @param remembered the stored id, or null
 * @param known every id that currently exists, or null while they load
 * @param alreadyTried whether the restore has already run this session
 */
export function resumeDecision(input: {
  remembered: string | null;
  known: string[] | null;
  alreadyTried: boolean;
}): ResumeAction {
  const { remembered, known, alreadyTried } = input;

  // Once the restore has had its turn, arriving at the index means the user
  // navigated here, and the index becomes the memory.
  if (alreadyTried) {
    return remembered ? { action: 'forget' } : { action: 'stay' };
  }

  // Deciding before the ids land would forget a perfectly good memory just
  // because the list hadn't loaded on a cold start — which is the launch the
  // shortcut is worth most on.
  if (known === null) return { action: 'wait' };

  // A list deleted on the laptop must not strand the phone on an empty screen.
  if (remembered && known.includes(remembered)) {
    return { action: 'open', id: remembered };
  }
  return remembered ? { action: 'forget' } : { action: 'stay' };
}

/**
 * Whether the restore has run this session, per section.
 *
 * Module state rather than storage: "have we tried yet" is about this launch,
 * and persisting it would mean the restore only ever worked once.
 */
const tried: Record<ResumeSection, boolean> = { lists: false, projects: false };

export function markResumeTried(section: ResumeSection): void {
  tried[section] = true;
}

export function hasResumeTried(section: ResumeSection): boolean {
  return tried[section];
}

/** Test seam — a fresh launch has tried neither. */
export function resetResumeTried(): void {
  tried.lists = false;
  tried.projects = false;
}

export async function loadResume(
  section: ResumeSection
): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY[section]);
  } catch {
    // A memory that fails to load is no memory, which is the index — a worse
    // shortcut, never a broken screen.
    return null;
  }
}

export async function saveResume(
  section: ResumeSection,
  id: string | null
): Promise<void> {
  try {
    if (id === null) await AsyncStorage.removeItem(KEY[section]);
    else await AsyncStorage.setItem(KEY[section], id);
  } catch {
    // Best-effort: the user is already looking at the right screen.
  }
}
