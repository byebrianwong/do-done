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
 * Whether the index should draw nothing yet, because it may be about to be
 * covered by the screen the tab remembers.
 *
 * The first tap on Lists or Projects each launch used to show the index and
 * then push the remembered screen over it with the full push animation: two
 * screens and a slide, to arrive somewhere the user had asked to go back to.
 * Now the index stays blank while the decision is pending and the restore is
 * pushed with no animation (`RESUME_PARAM`), so the tab opens on the list.
 *
 * It must never hold the index blank for good. `resumeDecision` returns `wait`
 * while the ids load, and an offline first launch can wait forever, so a
 * failed read or `gaveUp` (set by a timer, `RESUME_HOLD_MAX_MS`) shows the
 * index regardless.
 *
 * @param remembered the stored id, null when there is none, or undefined while
 *   it is still being read
 * @param known every id that currently exists, or null while they load
 */
export function holdIndexBlank(input: {
  remembered: string | null | undefined;
  known: string[] | null;
  alreadyTried: boolean;
  failed: boolean;
  gaveUp: boolean;
}): boolean {
  const { remembered, known, alreadyTried, failed, gaveUp } = input;
  if (alreadyTried || failed || gaveUp) return false;
  // Storage answers within a frame or two; the index is not worth drawing for
  // that long when it may be covered.
  if (remembered === undefined) return true;
  if (remembered === null) return false;
  if (known === null) return true;
  return known.includes(remembered);
}

/**
 * The longest the index stays blank waiting to learn whether to restore. Past
 * this the index draws, and a restore that lands later is pushed with the
 * ordinary animation, since the user has by then seen the index.
 */
export const RESUME_HOLD_MAX_MS = 600;

/**
 * The query param a restore push carries. The `[id]` screens' options read it
 * to push with no animation; see `resumeScreenAnimation`.
 */
export const RESUME_PARAM = 'resume';

/**
 * The stack animation a detail screen in these tabs is pushed with. `none` for
 * a restore the index was held blank for, the default otherwise.
 */
export function resumeScreenAnimation(
  params: Record<string, unknown> | undefined
): 'none' | 'default' {
  return params?.[RESUME_PARAM] === '1' ? 'none' : 'default';
}

/** The path a restore pushes, with or without the no-animation flag. */
export function resumePath(
  section: ResumeSection,
  id: string,
  quiet: boolean
): string {
  return quiet ? `/${section}/${id}?${RESUME_PARAM}=1` : `/${section}/${id}`;
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
