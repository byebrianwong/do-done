const CATEGORY_KEYWORDS: Record<string, string[]> = {
  groceries: ["buy", "grocery", "groceries", "milk", "eggs", "bread", "store", "supermarket"],
  work: ["meeting", "email", "report", "deadline", "presentation", "client", "review", "deploy"],
  personal: ["call", "doctor", "appointment", "birthday", "gift"],
  health: ["gym", "workout", "exercise", "run", "yoga", "meditation", "walk"],
  finance: ["pay", "bill", "invoice", "tax", "bank", "transfer", "budget"],
  home: ["clean", "fix", "repair", "organize", "laundry", "dishes", "cook"],
  learning: ["read", "study", "course", "learn", "practice", "tutorial"],
};

export function suggestCategories(title: string): string[] {
  const lower = title.toLowerCase();
  const matches: string[] = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matches.push(category);
    }
  }

  return matches;
}

export function suggestTags(title: string): string[] {
  const tags: string[] = [];

  if (/\b(urgent|asap|immediately)\b/i.test(title)) tags.push("urgent");
  if (/\b(quick|fast|5\s*min)\b/i.test(title)) tags.push("quick");
  if (/\b(waiting|blocked|depends)\b/i.test(title)) tags.push("waiting");
  if (/\b(recurring|weekly|daily|monthly)\b/i.test(title)) tags.push("recurring");

  return tags;
}
