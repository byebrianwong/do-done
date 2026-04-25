/**
 * Detect recurrence patterns in natural language and convert to RRULE strings.
 *
 * RRULE reference: https://datatracker.ietf.org/doc/html/rfc5545#section-3.3.10
 *
 * Returns the matched substring (so the caller can strip it) and an RRULE string.
 */

const DAY_TO_BYDAY: Record<string, string> = {
  monday: "MO",
  mon: "MO",
  tuesday: "TU",
  tue: "TU",
  tues: "TU",
  wednesday: "WE",
  wed: "WE",
  thursday: "TH",
  thu: "TH",
  thur: "TH",
  thurs: "TH",
  friday: "FR",
  fri: "FR",
  saturday: "SA",
  sat: "SA",
  sunday: "SU",
  sun: "SU",
};

const FREQ_KEYWORDS: Array<{ pattern: RegExp; rrule: string }> = [
  // "every weekday" / "on weekdays"
  {
    pattern: /\bevery\s+weekday\b|\bon\s+weekdays\b/i,
    rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  },
  // "every weekend"
  {
    pattern: /\bevery\s+weekend\b/i,
    rrule: "FREQ=WEEKLY;BYDAY=SA,SU",
  },
  // "biweekly" / "every other week" / "every 2 weeks"
  {
    pattern: /\b(?:biweekly|every\s+other\s+week|every\s+2\s+weeks?)\b/i,
    rrule: "FREQ=WEEKLY;INTERVAL=2",
  },
  // "daily" / "every day"
  {
    pattern: /\b(?:daily|every\s+day)\b/i,
    rrule: "FREQ=DAILY",
  },
  // "weekly" / "every week"
  {
    pattern: /\b(?:weekly|every\s+week)\b/i,
    rrule: "FREQ=WEEKLY",
  },
  // "monthly" / "every month"
  {
    pattern: /\b(?:monthly|every\s+month)\b/i,
    rrule: "FREQ=MONTHLY",
  },
  // "yearly" / "annually" / "every year"
  {
    pattern: /\b(?:yearly|annually|every\s+year)\b/i,
    rrule: "FREQ=YEARLY",
  },
];

// "every N days/weeks/months/years"
const INTERVAL_PATTERN =
  /\bevery\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\b/i;

const INTERVAL_FREQ: Record<string, string> = {
  day: "DAILY",
  days: "DAILY",
  week: "WEEKLY",
  weeks: "WEEKLY",
  month: "MONTHLY",
  months: "MONTHLY",
  year: "YEARLY",
  years: "YEARLY",
};

// "every monday", "every monday and friday"
const DAY_OF_WEEK_PATTERN = new RegExp(
  `\\bevery\\s+((?:${Object.keys(DAY_TO_BYDAY).join(
    "|"
  )})(?:\\s*(?:and|,|&)\\s*(?:${Object.keys(DAY_TO_BYDAY).join("|")}))*)\\b`,
  "i"
);

export interface RecurrenceMatch {
  rrule: string;
  matched: string;
}

export function detectRecurrence(text: string): RecurrenceMatch | null {
  // 1. "every N units" — most specific, check first
  const intervalMatch = INTERVAL_PATTERN.exec(text);
  if (intervalMatch) {
    const n = parseInt(intervalMatch[1], 10);
    const freq = INTERVAL_FREQ[intervalMatch[2].toLowerCase()];
    return {
      rrule: n === 1 ? `FREQ=${freq}` : `FREQ=${freq};INTERVAL=${n}`,
      matched: intervalMatch[0],
    };
  }

  // 2. "every monday" / "every monday and friday"
  const dayMatch = DAY_OF_WEEK_PATTERN.exec(text);
  if (dayMatch) {
    const days = dayMatch[1]
      .toLowerCase()
      .split(/\s*(?:and|,|&)\s*/)
      .map((d) => DAY_TO_BYDAY[d.trim()])
      .filter(Boolean);
    if (days.length > 0) {
      return {
        rrule: `FREQ=WEEKLY;BYDAY=${days.join(",")}`,
        matched: dayMatch[0],
      };
    }
  }

  // 3. Generic frequency keywords
  for (const { pattern, rrule } of FREQ_KEYWORDS) {
    const match = pattern.exec(text);
    if (match) {
      return { rrule, matched: match[0] };
    }
  }

  return null;
}

/**
 * Human-readable summary of an RRULE string for UI display.
 */
export function formatRrule(rrule: string): string {
  const parts: Record<string, string> = {};
  for (const part of rrule.split(";")) {
    const [k, v] = part.split("=");
    parts[k] = v;
  }

  const interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1;
  const freq = parts.FREQ;
  const byday = parts.BYDAY?.split(",") ?? [];

  if (freq === "DAILY") return interval === 1 ? "Daily" : `Every ${interval} days`;
  if (freq === "WEEKLY") {
    if (byday.length > 0) {
      const dayNames = byday.map(
        (d) =>
          ({ MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" })[
            d
          ] ?? d
      );
      // weekdays
      const isWeekdays =
        byday.length === 5 &&
        byday.every((d) => ["MO", "TU", "WE", "TH", "FR"].includes(d));
      if (isWeekdays) return "Weekdays";
      const isWeekend =
        byday.length === 2 && byday.includes("SA") && byday.includes("SU");
      if (isWeekend) return "Weekends";
      return interval === 1
        ? dayNames.join(", ")
        : `Every ${interval}w on ${dayNames.join(", ")}`;
    }
    return interval === 1 ? "Weekly" : `Every ${interval} weeks`;
  }
  if (freq === "MONTHLY")
    return interval === 1 ? "Monthly" : `Every ${interval} months`;
  if (freq === "YEARLY")
    return interval === 1 ? "Yearly" : `Every ${interval} years`;
  return rrule;
}
