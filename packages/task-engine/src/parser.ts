import * as chrono from "chrono-node";
import type { ParsedTask, TaskPriority, WhenBucket } from "@do-done/shared";
import { detectRecurrence } from "./recurrence.js";

const PRIORITY_PATTERNS: [RegExp, TaskPriority][] = [
  [/\b(?:p1|!!!)\b/i, "p1"],
  [/\b(?:p2|!!)\b/i, "p2"],
  [/\b(?:p3|!)\b/i, "p3"],
  [/\bp4\b/i, "p4"],
];

// T-shirt-size hashtag shortcuts for estimates. The # is REQUIRED — bare
// "s", "m", "l" are far too common in English to read as size codes.
// Order doesn't matter because each literal `#xxl`, `#xs` etc. is disjoint
// (e.g. "#xl" does not appear inside "#xxl").
const ESTIMATE_SHORTCUT_PATTERNS: [RegExp, number][] = [
  [/#xxl\b/i, 960],
  [/#xl\b/i, 480],
  [/#xs\b/i, 30],
  [/#s\b/i, 60],
  [/#m\b/i, 120],
  [/#l\b/i, 240],
];

// /<command> slash commands for "when" scheduling.
// Two flavors:
//   - WHEN_DATE_PATTERNS resolve to a specific calendar date relative to ref
//   - WHEN_BUCKET_PATTERNS resolve to a soft scheduling bucket
// These are extracted BEFORE PROJECT_PATTERN so that "/today" doesn't get
// mistakenly read as a project named "today".
const WHEN_DATE_PATTERNS: [RegExp, (ref: Date) => Date][] = [
  [/(?:^|\s)\/today\b/i, (ref) => ref],
  [
    /(?:^|\s)\/tomorrow\b/i,
    (ref) => {
      const d = new Date(ref);
      d.setDate(d.getDate() + 1);
      return d;
    },
  ],
];

const WHEN_BUCKET_PATTERNS: [RegExp, WhenBucket][] = [
  // Match "/this-week" or "/this_week" or "/week" — all the same intent
  [/(?:^|\s)\/(?:this[-_]week|week)\b/i, "this_week"],
  [/(?:^|\s)\/next[-_]week\b/i, "next_week"],
  [/(?:^|\s)\/later\b/i, "later"],
  [/(?:^|\s)\/someday\b/i, "someday"],
];

// Reserved tokens that should not be treated as project names by PROJECT_PATTERN.
const RESERVED_SLASH_TOKENS = new Set([
  "today",
  "tomorrow",
  "week",
  "this-week",
  "this_week",
  "next-week",
  "next_week",
  "later",
  "someday",
  "p1",
  "p2",
  "p3",
  "p4",
]);

const DURATION_PATTERN = /\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/i;
// Explicit ~ prefix variant — same body as DURATION_PATTERN, just with ~ in front.
const ESTIMATE_PREFIX_PATTERN = /~\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/i;

const TAG_PATTERN = /#(\w+)/g;
const PROJECT_PATTERN = /(?:\/|project:)(\S+)/i;

function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseTaskInput(raw: string, referenceDate?: Date): ParsedTask {
  let text = raw.trim();
  const ref = referenceDate ?? new Date();

  // Extract priority
  let priority: TaskPriority | undefined;
  for (const [pattern, p] of PRIORITY_PATTERNS) {
    if (pattern.test(text)) {
      priority = p;
      text = text.replace(pattern, "").trim();
      break;
    }
  }

  // Extract /when slash commands. Resolve to either a specific date
  // (when_date) or a soft bucket (when_bucket). Date wins if both
  // somehow match — they're mutually exclusive per the schema.
  let whenDate: string | undefined;
  let whenBucket: WhenBucket | undefined;
  for (const [pattern, toDate] of WHEN_DATE_PATTERNS) {
    if (pattern.test(text)) {
      whenDate = toISODate(toDate(ref));
      text = text.replace(pattern, " ").trim();
      break;
    }
  }
  if (!whenDate) {
    for (const [pattern, bucket] of WHEN_BUCKET_PATTERNS) {
      if (pattern.test(text)) {
        whenBucket = bucket;
        text = text.replace(pattern, " ").trim();
        break;
      }
    }
  }

  // Extract estimate shortcuts (#xs, #s, #m, #l, #xl, #xxl) BEFORE
  // generic tag extraction — otherwise the tag pattern would consume
  // them as tag names. First match wins (and we already ordered them so
  // there are no substring conflicts).
  let shortcutDuration: number | undefined;
  for (const [pattern, mins] of ESTIMATE_SHORTCUT_PATTERNS) {
    if (pattern.test(text)) {
      shortcutDuration = mins;
      text = text.replace(pattern, " ").trim();
      break;
    }
  }

  // Extract tags
  const tags: string[] = [];
  let tagMatch: RegExpExecArray | null;
  const tagRegex = new RegExp(TAG_PATTERN.source, "g");
  while ((tagMatch = tagRegex.exec(text)) !== null) {
    tags.push(tagMatch[1]);
  }
  text = text.replace(TAG_PATTERN, "").trim();

  // Extract project — skip reserved slash tokens (since /today etc. have
  // already been pulled out above, but a stray slash-command alias the
  // user mis-typed shouldn't accidentally become a project name).
  let project: string | undefined;
  const projectMatch = PROJECT_PATTERN.exec(text);
  if (projectMatch && !RESERVED_SLASH_TOKENS.has(projectMatch[1].toLowerCase())) {
    project = projectMatch[1];
    text = text.replace(PROJECT_PATTERN, "").trim();
  }

  // Extract duration. Precedence: explicit ~ prefix > bare "1.5h" >
  // size-hashtag shortcut. An explicit numeric estimate beats a size
  // hashtag if the user happened to type both.
  let durationMinutes: number | undefined;
  const estPrefixMatch = ESTIMATE_PREFIX_PATTERN.exec(text);
  if (estPrefixMatch) {
    const value = parseFloat(estPrefixMatch[1]);
    const unit = estPrefixMatch[2].toLowerCase();
    durationMinutes = unit.startsWith("h") ? Math.round(value * 60) : Math.round(value);
    text = text.replace(ESTIMATE_PREFIX_PATTERN, "").trim();
  } else {
    const durationMatch = DURATION_PATTERN.exec(text);
    if (durationMatch) {
      const value = parseFloat(durationMatch[1]);
      const unit = durationMatch[2].toLowerCase();
      durationMinutes = unit.startsWith("h") ? Math.round(value * 60) : Math.round(value);
      text = text.replace(DURATION_PATTERN, "").trim();
    }
  }
  if (durationMinutes === undefined && shortcutDuration !== undefined) {
    durationMinutes = shortcutDuration;
  }

  // Extract recurrence (before chrono-node, since "every monday" overlaps)
  let recurrenceRule: string | undefined;
  const recMatch = detectRecurrence(text);
  if (recMatch) {
    recurrenceRule = recMatch.rrule;
    text = text.replace(recMatch.matched, "").trim();
  }

  // Extract dates using chrono — produces due_date / due_time.
  // The new /today, /tomorrow slash commands above produce when_date instead,
  // so both can coexist (e.g. "/today review PR by friday" → when_date=today,
  // due_date=friday).
  let dueDate: string | undefined;
  let dueTime: string | undefined;
  const chronoResults = chrono.parse(text, ref, { forwardDate: true });
  if (chronoResults.length > 0) {
    const result = chronoResults[0];
    const start = result.start;

    const d = start.date();
    dueDate = toISODate(d);

    if (start.isCertain("hour")) {
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      dueTime = `${hours}:${minutes}`;
    }

    text = text.replace(result.text, "").trim();
  }

  // Clean up extra whitespace and orphan `#` chars left over when a
  // shortcut consumed only the body of a `#token` (e.g. priority match
  // `\bp2\b` strips "p2" out of "#p2" but leaves the leading `#`).
  const title = text
    .replace(/(^|\s)#(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title || raw.trim(),
    ...(whenDate && { when_date: whenDate }),
    ...(whenBucket && { when_bucket: whenBucket }),
    ...(dueDate && { due_date: dueDate }),
    ...(dueTime && { due_time: dueTime }),
    ...(priority && { priority }),
    ...(project && { project }),
    ...(tags.length > 0 && { tags }),
    ...(durationMinutes && { duration_minutes: durationMinutes }),
    ...(recurrenceRule && { recurrence_rule: recurrenceRule }),
  };
}
