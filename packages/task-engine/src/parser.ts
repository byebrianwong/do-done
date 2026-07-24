import * as chrono from "chrono-node";
import type { ParsedTask, TaskPriority } from "@do-done/shared";
import { addDaysLocalISO, nextWeekdayLocalISO, todayLocalISO } from "@do-done/shared";
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

// /<command> slash commands for "when" scheduling. Each resolves to a specific
// local calendar date relative to ref — DoDone has no fuzzy "buckets", so the
// human-friendly words map straight to concrete days:
//   /today → today, /tomorrow → +1, /week (a.k.a. /this-week) → this Friday,
//   /weekend (a.k.a. /this-weekend) → upcoming Sunday, /next-week → exactly +7.
// Extracted BEFORE PROJECT_PATTERN so "/today" isn't read as a project name.
const WHEN_DATE_PATTERNS: [RegExp, (ref: Date) => string][] = [
  [/(?:^|\s)\/today\b/i, (ref) => todayLocalISO(ref)],
  [/(?:^|\s)\/tomorrow\b/i, (ref) => addDaysLocalISO(1, ref)],
  [/(?:^|\s)\/next[-_]week\b/i, (ref) => addDaysLocalISO(7, ref)],
  [/(?:^|\s)\/(?:this[-_])?weekend\b/i, (ref) => nextWeekdayLocalISO(0, ref)],
  [/(?:^|\s)\/(?:this[-_]week|week)\b/i, (ref) => nextWeekdayLocalISO(5, ref)],
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
  "weekend",
  "this-weekend",
  "this_weekend",
  // Retired scheduling commands — kept reserved so a stray "/later" isn't
  // misread as a project name; they simply have no effect now.
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

// URLs must survive parsing verbatim. A raw link like
// "https://example.com/a/b#c" is full of characters the extractors below claim:
// the scheme's `//` reads as a `/project` delimiter (truncating the title at
// the colon), a `#fragment` reads as a `#tag`, and `1h`-style path segments
// read as durations. Mask every URL with an opaque placeholder BEFORE any
// extraction runs, then restore it in the final title. The placeholder is
// bracketed by private-use codepoints that never occur in real task text and
// match none of the token patterns (no `/`, `#`, `~`, `!`, `p1`, or unit
// letters), so it passes through untouched.
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;
const URL_MASK_OPEN = "\uE000";
const URL_MASK_CLOSE = "\uE001";

function maskUrls(text: string, urls: string[]): string {
  return text.replace(URL_PATTERN, (match) => {
    const token = `${URL_MASK_OPEN}${urls.length}${URL_MASK_CLOSE}`;
    urls.push(match);
    return token;
  });
}

function restoreUrls(text: string, urls: string[]): string {
  if (urls.length === 0) return text;
  return text.replace(
    new RegExp(`${URL_MASK_OPEN}(\\d+)${URL_MASK_CLOSE}`, "g"),
    (_full, index: string) => urls[Number(index)] ?? ""
  );
}

function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseTaskInput(raw: string, referenceDate?: Date): ParsedTask {
  let text = raw.trim();
  const ref = referenceDate ?? new Date();

  // Mask URLs first so the token extractors below can't chew through the
  // characters that are legal inside a link (`//`, `:`, `#`, `1h` path bits).
  // Restored verbatim into the title at the very end.
  const urls: string[] = [];
  text = maskUrls(text, urls);

  // Extract priority
  let priority: TaskPriority | undefined;
  for (const [pattern, p] of PRIORITY_PATTERNS) {
    if (pattern.test(text)) {
      priority = p;
      text = text.replace(pattern, "").trim();
      break;
    }
  }

  // Extract /when slash commands — each resolves to a concrete when_date.
  let whenDate: string | undefined;
  for (const [pattern, toDate] of WHEN_DATE_PATTERNS) {
    if (pattern.test(text)) {
      whenDate = toDate(ref);
      text = text.replace(pattern, " ").trim();
      break;
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
  const cleaned = text
    .replace(/(^|\s)#(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // Restore any masked URLs verbatim now that all extraction is done.
  const title = restoreUrls(cleaned, urls);

  return {
    title: title || raw.trim(),
    ...(whenDate && { when_date: whenDate }),
    ...(dueDate && { due_date: dueDate }),
    ...(dueTime && { due_time: dueTime }),
    ...(priority && { priority }),
    ...(project && { project }),
    ...(tags.length > 0 && { tags }),
    ...(durationMinutes && { duration_minutes: durationMinutes }),
    ...(recurrenceRule && { recurrence_rule: recurrenceRule }),
  };
}
