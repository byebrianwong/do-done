import * as chrono from "chrono-node";
import type { ParsedTask, ProjectRef, TaskPriority } from "@do-done/shared";
import {
  addDaysLocalISO,
  matchProject,
  nextWeekdayLocalISO,
  todayLocalISO,
} from "@do-done/shared";
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
const SCHEDULED_DATE_PATTERNS: [RegExp, (ref: Date) => string][] = [
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

// What makes a date a *deadline* instead of a schedule.
//
// Everything chrono finds is `scheduled_date` — the day the user plans to DO
// the task — unless the words "due" or "deadline" introduce it. That's the way
// round the ratio demands: nearly every dated task has a scheduled date and
// almost none has a deadline, so reading "buy milk tomorrow" as a deadline left
// the task unscheduled and invisible to every view that schedules by day.
//
// Matched against the text immediately *before* the date chrono found, so:
//   "submit report friday"        → scheduled_date = friday
//   "submit report due friday"    → deadline_date  = friday
//   "submit report due by friday" → deadline_date  = friday
// The optional tail absorbs the connector chrono leaves behind ("due by",
// "deadline: ", "due date"), so the marker comes out of the title whole.
// Deliberately narrow: "by friday" alone is NOT a deadline. It reads like one
// in English, but it's also how people say the day they'll get to something,
// and the cost of guessing wrong is a task nobody sees.
const DEADLINE_MARKER_PATTERN =
  /\b(?:due|deadline)\b[\s:,-]*(?:date\b[\s:,-]*)?(?:by|on|before|at|is|for)?[\s:,-]*$/i;

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

export interface ParseTaskOptions {
  /**
   * The user's projects, for matching a typed `#name` / `/name` to a real one.
   *
   * Omit them and a `#token` is a tag and `/token` a bare project *name*, which
   * is all this parser could produce before — so every existing caller keeps
   * its old behaviour, and only the surfaces that pass a list gain `project_id`.
   */
  projects?: readonly ProjectRef[];
}

export function parseTaskInput(
  raw: string,
  referenceDate?: Date,
  options: ParseTaskOptions = {}
): ParsedTask {
  let text = raw.trim();
  const ref = referenceDate ?? new Date();
  const knownProjects = options.projects;

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

  // Extract /when slash commands — each resolves to a concrete scheduled_date.
  let scheduledDate: string | undefined;
  for (const [pattern, toDate] of SCHEDULED_DATE_PATTERNS) {
    if (pattern.test(text)) {
      scheduledDate = toDate(ref);
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

  // Extract tags — except that a `#token` naming one of the user's projects is
  // that project, not a tag (Todoist's `#project`). Only when a project list
  // was supplied: with nothing to match against, every token is a tag as before.
  const tags: string[] = [];
  let project: string | undefined;
  let projectId: string | undefined;
  let tagMatch: RegExpExecArray | null;
  const tagRegex = new RegExp(TAG_PATTERN.source, "g");
  while ((tagMatch = tagRegex.exec(text)) !== null) {
    const hit = projectId ? undefined : matchProject(tagMatch[1], knownProjects);
    if (hit) {
      projectId = hit.id;
      project = hit.name;
    } else {
      tags.push(tagMatch[1]);
    }
  }
  text = text.replace(TAG_PATTERN, "").trim();

  // Extract project — skip reserved slash tokens (since /today etc. have
  // already been pulled out above, but a stray slash-command alias the
  // user mis-typed shouldn't accidentally become a project name).
  const projectMatch = PROJECT_PATTERN.exec(text);
  if (projectMatch && !RESERVED_SLASH_TOKENS.has(projectMatch[1].toLowerCase())) {
    // A `#name` already resolved to a real project outranks a `/name` guess.
    if (!projectId) {
      const hit = matchProject(projectMatch[1], knownProjects);
      project = hit ? hit.name : projectMatch[1];
      projectId = hit?.id;
    }
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

  // Extract dates using chrono. A plain date is the day the user plans to do
  // the task (scheduled_date); only one introduced by "due"/"deadline" becomes
  // deadline_date. The /today, /tomorrow slash commands above already produced
  // a scheduled_date, so both can coexist (e.g. "/today review PR due friday"
  // → scheduled_date=today, deadline_date=friday).
  let scheduledTime: string | undefined;
  let deadlineDate: string | undefined;
  let deadlineTime: string | undefined;
  let tookScheduledFromText = false;
  // [start, end) spans to cut out of the title once every result is classified;
  // splicing as we go would invalidate the indexes of the results after it.
  const dateCuts: [number, number][] = [];

  for (const result of chrono.parse(text, ref, { forwardDate: true })) {
    const marker = DEADLINE_MARKER_PATTERN.exec(text.slice(0, result.index));
    // One date per field. A second date of the same kind stays in the title
    // rather than being swallowed by a field that can't hold it.
    if (marker ? deadlineDate !== undefined : tookScheduledFromText) continue;

    const start = result.start;
    const d = start.date();
    let time: string | undefined;
    if (start.isCertain("hour")) {
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      time = `${hours}:${minutes}`;
    }

    if (marker) {
      deadlineDate = toISODate(d);
      deadlineTime = time;
    } else {
      tookScheduledFromText = true;
      // A /slash command is the more deliberate statement of the day, so it
      // keeps it — but a time typed in prose ("/today call mum at 3pm") has
      // nothing to collide with and still applies.
      scheduledDate ??= toISODate(d);
      scheduledTime = time;
    }

    dateCuts.push([
      marker ? marker.index : result.index,
      result.index + result.text.length,
    ]);
  }

  for (const [start, end] of dateCuts.reverse()) {
    text = `${text.slice(0, start)} ${text.slice(end)}`;
  }
  text = text.trim();

  // Clean up extra whitespace and orphan `#` chars left over when a
  // shortcut consumed only the body of a `#token` (e.g. priority match
  // `\bp2\b` strips "p2" out of "#p2" but leaves the leading `#`).
  // A cut date takes its own spacing with it but not the punctuation around it
  // ("draft memo tomorrow, due friday" → "draft memo ,"), so close the gap in
  // front of any punctuation the cut orphaned. URLs are still masked here, so
  // this can't touch one.
  const cleaned = text
    .replace(/(^|\s)#(?=\s|$)/g, "$1")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // Restore any masked URLs verbatim now that all extraction is done.
  const title = restoreUrls(cleaned, urls);

  return {
    title: title || raw.trim(),
    ...(scheduledDate && { scheduled_date: scheduledDate }),
    ...(scheduledTime && { scheduled_time: scheduledTime }),
    ...(deadlineDate && { deadline_date: deadlineDate }),
    ...(deadlineTime && { deadline_time: deadlineTime }),
    ...(priority && { priority }),
    ...(project && { project }),
    ...(projectId && { project_id: projectId }),
    ...(tags.length > 0 && { tags }),
    ...(durationMinutes && { duration_minutes: durationMinutes }),
    ...(recurrenceRule && { recurrence_rule: recurrenceRule }),
  };
}
