import * as chrono from "chrono-node";
import type { ParsedTask, TaskPriority } from "@do-done/shared";
import { detectRecurrence } from "./recurrence.js";

const PRIORITY_PATTERNS: [RegExp, TaskPriority][] = [
  [/\b(?:p1|!!!)\b/i, "p1"],
  [/\b(?:p2|!!)\b/i, "p2"],
  [/\b(?:p3|!)\b/i, "p3"],
  [/\bp4\b/i, "p4"],
];

const DURATION_PATTERN = /\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/i;

const TAG_PATTERN = /#(\w+)/g;
const PROJECT_PATTERN = /(?:\/|project:)(\S+)/i;

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

  // Extract tags
  const tags: string[] = [];
  let tagMatch: RegExpExecArray | null;
  const tagRegex = new RegExp(TAG_PATTERN.source, "g");
  while ((tagMatch = tagRegex.exec(text)) !== null) {
    tags.push(tagMatch[1]);
  }
  text = text.replace(TAG_PATTERN, "").trim();

  // Extract project
  let project: string | undefined;
  const projectMatch = PROJECT_PATTERN.exec(text);
  if (projectMatch) {
    project = projectMatch[1];
    text = text.replace(PROJECT_PATTERN, "").trim();
  }

  // Extract duration
  let durationMinutes: number | undefined;
  const durationMatch = DURATION_PATTERN.exec(text);
  if (durationMatch) {
    const value = parseFloat(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    durationMinutes = unit.startsWith("h") ? Math.round(value * 60) : Math.round(value);
    text = text.replace(DURATION_PATTERN, "").trim();
  }

  // Extract recurrence (before chrono-node, since "every monday" overlaps)
  let recurrenceRule: string | undefined;
  const recMatch = detectRecurrence(text);
  if (recMatch) {
    recurrenceRule = recMatch.rrule;
    text = text.replace(recMatch.matched, "").trim();
  }

  // Extract dates using chrono
  let dueDate: string | undefined;
  let dueTime: string | undefined;
  const chronoResults = chrono.parse(text, ref, { forwardDate: true });
  if (chronoResults.length > 0) {
    const result = chronoResults[0];
    const start = result.start;

    const d = start.date();
    dueDate = d.toISOString().split("T")[0];

    if (start.isCertain("hour")) {
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      dueTime = `${hours}:${minutes}`;
    }

    text = text.replace(result.text, "").trim();
  }

  // Clean up extra whitespace
  const title = text.replace(/\s+/g, " ").trim();

  return {
    title: title || raw.trim(),
    ...(dueDate && { due_date: dueDate }),
    ...(dueTime && { due_time: dueTime }),
    ...(priority && { priority }),
    ...(project && { project }),
    ...(tags.length > 0 && { tags }),
    ...(durationMinutes && { duration_minutes: durationMinutes }),
    ...(recurrenceRule && { recurrence_rule: recurrenceRule }),
  };
}
