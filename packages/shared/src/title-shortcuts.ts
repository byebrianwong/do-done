import type { TaskPriority } from "./schemas.js";
import { matchProject, type ProjectRef } from "./project-match.js";

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

/** What a single `#token` turned out to mean. */
export type ShortcutToken =
  | { kind: "estimate"; durationMinutes: number }
  | { kind: "priority"; priority: TaskPriority }
  | { kind: "project"; projectId: string }
  | { kind: "tag"; tag: string };

/**
 * Classify one bare token (no leading `#`), in the fixed precedence order
 * size → priority → project → tag.
 *
 * The loop below is one caller; the other is every **"+ tag" control**, which
 * reaches this classification without going through a title at all. Those
 * fields used to store whatever was typed verbatim, so `#personal` typed into
 * a title filed the task into the Personal project while `personal` typed into
 * the tag field two inches away made a tag of the same name — the same word,
 * meaning two different things depending on which box it was typed in. A
 * classification the user can't see the rule for has to be the same rule
 * everywhere, which is why it is a function rather than a comment.
 */
export function classifyShortcutToken(
  token: string,
  projects?: readonly ProjectRef[]
): ShortcutToken {
  const lower = token.toLowerCase();
  if (lower in ESTIMATE_SHORTCUTS)
    return { kind: "estimate", durationMinutes: ESTIMATE_SHORTCUTS[lower] };
  if (lower in PRIORITY_SHORTCUTS)
    return { kind: "priority", priority: PRIORITY_SHORTCUTS[lower] };
  const project = matchProject(token, projects);
  if (project) return { kind: "project", projectId: project.id };
  return { kind: "tag", tag: token };
}

export interface TitleShortcuts {
  /** The title with every consumed `#token` removed. */
  stripped: string;
  tags: string[];
  priority?: TaskPriority;
  durationMinutes?: number;
  /** Set when a `#token` named one of the `projects` passed in. */
  projectId?: string;
}

/**
 * Pull `#token` shortcuts out of `text`, classifying each one:
 *   - `#xs` `#s` `#m` `#l` `#xl` `#xxl` → `durationMinutes`
 *   - `#p1`…`#p4`                      → `priority`
 *   - the name of a known project      → `projectId`
 *   - anything else                    → a tag
 *
 * Pass `projects` for that third case — without it (Storybook, a surface with
 * no project list to hand) `#groceries` is simply a tag, which is what every
 * `#token` was before. The size and priority codes are checked first, so a
 * project named "M" or "P1" loses to the shortcut rather than shadowing it.
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
  flushTrailing = false,
  projects?: readonly ProjectRef[]
): TitleShortcuts {
  const tags: string[] = [];
  let priority: TaskPriority | undefined;
  let durationMinutes: number | undefined;
  let projectId: string | undefined;

  const re = flushTrailing ? /#(\w+)(?:\s+|$)/g : /#(\w+)\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const classified = classifyShortcutToken(m[1], projects);
    switch (classified.kind) {
      case "estimate":
        durationMinutes = classified.durationMinutes;
        break;
      case "priority":
        priority = classified.priority;
        break;
      case "project":
        projectId = classified.projectId;
        break;
      default:
        tags.push(classified.tag);
    }
  }

  if (
    tags.length === 0 &&
    priority === undefined &&
    durationMinutes === undefined &&
    projectId === undefined
  ) {
    return { stripped: text, tags };
  }

  const stripped = text
    .replace(flushTrailing ? /#(\w+)(?:\s+|$)/g : /#(\w+)\s+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trimEnd();

  return { stripped, tags, priority, durationMinutes, projectId };
}
