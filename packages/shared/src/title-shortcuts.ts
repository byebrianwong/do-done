import type { TaskPriority } from "./schemas.js";

/**
 * `#token` shortcuts typed inline in a task title.
 *
 * This is the *live* absorber the title fields use as you type — distinct from
 * `parseTaskInput` in `@do-done/task-engine`, which parses a whole quick-add
 * string once at submit. Both must agree on what a `#token` means, or the same
 * text yields different tasks depending on which surface you typed it into.
 *
 * It lives here because it previously did not: web classified `#p1` as a
 * priority and `#xs` as an estimate, while mobile's copy only ever produced
 * tags — so on mobile `#p1` silently became a tag literally named "p1", and
 * because the absorber runs on every keystroke it stripped the token before
 * `parseTaskInput` could ever see it at submit.
 */

/** T-shirt sizes → minutes. Mirrors `ESTIMATE_SHORTCUT_PATTERNS` in the parser. */
const ESTIMATE_SHORTCUTS: Record<string, number> = {
  xs: 30,
  s: 60,
  m: 120,
  l: 240,
  xl: 480,
  xxl: 960,
};

const PRIORITY_SHORTCUTS: Record<string, TaskPriority> = {
  p1: "p1",
  p2: "p2",
  p3: "p3",
  p4: "p4",
};

export interface TitleShortcuts {
  /** The title with every consumed `#token` removed. */
  stripped: string;
  tags: string[];
  priority?: TaskPriority;
  durationMinutes?: number;
}

/**
 * Pull `#token` shortcuts out of `text`, classifying each one:
 *   - `#xs` `#s` `#m` `#l` `#xl` `#xxl` → `durationMinutes`
 *   - `#p1`…`#p4`                      → `priority`
 *   - anything else                    → a tag
 *
 * By default only a *whitespace-terminated* token is consumed, so `#x` is left
 * alone while the user is still typing their way to `#xs`.
 *
 * That makes the trailing space the only terminator, which is a trap: a title
 * finished as "buy toothpaste #xs" — no space, then blur or close — saved the
 * token into the title verbatim. Pass `flushTrailing` from blur / Enter / the
 * close path, where end-of-input is a legitimate terminator because the user
 * has demonstrably stopped typing.
 */
export function extractTitleShortcuts(
  text: string,
  flushTrailing = false
): TitleShortcuts {
  const tags: string[] = [];
  let priority: TaskPriority | undefined;
  let durationMinutes: number | undefined;

  const re = flushTrailing ? /#(\w+)(?:\s+|$)/g : /#(\w+)\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[1].toLowerCase();
    if (token in ESTIMATE_SHORTCUTS) {
      durationMinutes = ESTIMATE_SHORTCUTS[token];
    } else if (token in PRIORITY_SHORTCUTS) {
      priority = PRIORITY_SHORTCUTS[token];
    } else {
      tags.push(m[1]);
    }
  }

  if (
    tags.length === 0 &&
    priority === undefined &&
    durationMinutes === undefined
  ) {
    return { stripped: text, tags };
  }

  const stripped = text
    .replace(flushTrailing ? /#(\w+)(?:\s+|$)/g : /#(\w+)\s+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trimEnd();

  return { stripped, tags, priority, durationMinutes };
}
