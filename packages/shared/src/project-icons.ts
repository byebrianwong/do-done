/**
 * The catalogue behind the project icon picker.
 *
 * `projects.icon` is a free string — the column is `text check (char_length <=
 * 10)` and both apps render it as plain text inside the task row's ring. So
 * nothing here is a fixed enum: a user may still paste any character they like,
 * and this file is the curated *menu*, not the schema.
 *
 * Two rules the catalogue has to keep, both enforced by `project-icons.test.ts`:
 *
 * - **Every entry fits in ten characters *and* ten UTF-16 units.** Postgres
 *   counts code points and JavaScript counts UTF-16 units, and the app validates
 *   with the JS one — so a ZWJ sequence like the four-person family (7 code
 *   points, 11 units) passes the database and is rejected by the client. Rather
 *   than let the two disagree, sequences that long are simply not offered.
 * - **One glyph per entry.** The ring is 20 px; two characters in it are a
 *   smudge.
 *
 * The last group is not emoji. `icon` has never required them — a glyph renders
 * in the row's own text colour, which is why ★ and ◆ read as typography rather
 * than as stickers. They're offered as a first-class choice for exactly that.
 */

export interface ProjectIconOption {
  /** The character stored in `projects.icon`. */
  char: string;
  /** What it is, shown as the tooltip and matched by search. */
  name: string;
  /** Extra words search should match — synonyms the name doesn't carry. */
  keywords?: readonly string[];
}

export interface ProjectIconGroup {
  id: string;
  label: string;
  icons: readonly ProjectIconOption[];
}

/**
 * Matches the `char_length(icon) <= 10` check on `projects.icon` and the
 * `z.string().max(10)` in `ProjectSchema`.
 */
export const PROJECT_ICON_MAX_LENGTH = 10;

export const PROJECT_ICON_GROUPS: readonly ProjectIconGroup[] = [
  {
    id: "work",
    label: "Work",
    icons: [
      { char: "💼", name: "Briefcase", keywords: ["work", "job", "business"] },
      { char: "🏢", name: "Office", keywords: ["building", "company"] },
      { char: "📊", name: "Bar chart", keywords: ["report", "data", "metrics"] },
      { char: "📈", name: "Growth", keywords: ["chart", "up", "revenue"] },
      { char: "📝", name: "Notes", keywords: ["write", "memo", "draft"] },
      { char: "📋", name: "Clipboard", keywords: ["list", "checklist", "admin"] },
      { char: "🗂", name: "Files", keywords: ["folder", "archive", "org"] },
      { char: "📌", name: "Pin", keywords: ["important", "sticky"] },
      { char: "🗓", name: "Calendar", keywords: ["schedule", "planning"] },
      { char: "⏰", name: "Deadline", keywords: ["alarm", "time", "urgent"] },
      { char: "🎯", name: "Goal", keywords: ["target", "okr", "focus"] },
      { char: "🚀", name: "Launch", keywords: ["ship", "release", "startup"] },
      { char: "⚙️", name: "Operations", keywords: ["settings", "process", "gear"] },
      { char: "💡", name: "Idea", keywords: ["brainstorm", "concept", "lightbulb"] },
      { char: "🤝", name: "Meeting", keywords: ["client", "partner", "deal"] },
      { char: "✉️", name: "Email", keywords: ["inbox", "mail", "message"] },
      { char: "📞", name: "Calls", keywords: ["phone", "ring"] },
      { char: "🧰", name: "Toolbox", keywords: ["maintenance", "utilities"] },
    ],
  },
  {
    id: "study",
    label: "Study",
    icons: [
      { char: "📚", name: "Books", keywords: ["reading", "library", "study"] },
      { char: "📖", name: "Reading", keywords: ["book", "chapter"] },
      { char: "🎓", name: "School", keywords: ["university", "course", "degree"] },
      { char: "✍️", name: "Writing", keywords: ["essay", "author", "draft"] },
      { char: "🧠", name: "Learning", keywords: ["brain", "think", "memory"] },
      { char: "🔬", name: "Research", keywords: ["science", "lab", "microscope"] },
      { char: "🧪", name: "Experiment", keywords: ["lab", "test", "chemistry"] },
      { char: "🧮", name: "Maths", keywords: ["abacus", "numbers", "count"] },
      { char: "🔭", name: "Astronomy", keywords: ["telescope", "space", "explore"] },
      { char: "🌐", name: "Languages", keywords: ["globe", "web", "world"] },
      { char: "🎒", name: "Backpack", keywords: ["school", "class"] },
      { char: "💻", name: "Code", keywords: ["laptop", "dev", "programming"] },
    ],
  },
  {
    id: "home",
    label: "Home",
    icons: [
      { char: "🏠", name: "Home", keywords: ["house", "personal"] },
      { char: "🛋", name: "Living room", keywords: ["sofa", "lounge", "furniture"] },
      { char: "🛏", name: "Bedroom", keywords: ["bed", "sleep"] },
      { char: "🚿", name: "Bathroom", keywords: ["shower", "clean"] },
      { char: "🧹", name: "Cleaning", keywords: ["chores", "tidy", "broom"] },
      { char: "🧺", name: "Laundry", keywords: ["washing", "clothes"] },
      { char: "🧼", name: "Washing up", keywords: ["soap", "dishes", "clean"] },
      { char: "🔨", name: "DIY", keywords: ["hammer", "repair", "build"] },
      { char: "🪛", name: "Fixing", keywords: ["screwdriver", "repair", "tools"] },
      { char: "🪴", name: "Plants", keywords: ["houseplant", "garden", "water"] },
      { char: "📦", name: "Moving", keywords: ["box", "packing", "storage"] },
      { char: "🔑", name: "Keys", keywords: ["access", "landlord", "rent"] },
      { char: "🚪", name: "Doors", keywords: ["room", "entry"] },
      { char: "🧾", name: "Bills", keywords: ["receipt", "utilities", "admin"] },
    ],
  },
  {
    id: "people",
    label: "People",
    icons: [
      { char: "👪", name: "Family", keywords: ["household", "kids", "parents"] },
      { char: "👶", name: "Baby", keywords: ["child", "kids", "newborn"] },
      { char: "🧑", name: "Person", keywords: ["someone", "me", "friend"] },
      { char: "👋", name: "Catch-ups", keywords: ["hello", "friends", "social"] },
      { char: "💬", name: "Conversations", keywords: ["chat", "talk", "message"] },
      { char: "❤️", name: "Love", keywords: ["heart", "partner", "relationship"] },
      { char: "🎉", name: "Celebration", keywords: ["party", "event", "fun"] },
      { char: "🎁", name: "Gifts", keywords: ["present", "birthday", "christmas"] },
      { char: "🎂", name: "Birthdays", keywords: ["cake", "anniversary"] },
      { char: "💌", name: "Cards", keywords: ["letter", "note", "thank you"] },
      { char: "🐶", name: "Dog", keywords: ["pet", "puppy", "walk"] },
      { char: "🐱", name: "Cat", keywords: ["pet", "kitten"] },
    ],
  },
  {
    id: "health",
    label: "Health",
    icons: [
      { char: "🏃", name: "Running", keywords: ["exercise", "cardio", "jog"] },
      { char: "🧘", name: "Meditation", keywords: ["yoga", "calm", "mindful"] },
      { char: "🏋️", name: "Gym", keywords: ["weights", "lifting", "strength"] },
      { char: "🚴", name: "Cycling", keywords: ["bike", "ride"] },
      { char: "🏊", name: "Swimming", keywords: ["pool", "swim"] },
      { char: "💪", name: "Fitness", keywords: ["strong", "training", "workout"] },
      { char: "⚽", name: "Football", keywords: ["soccer", "sport", "team"] },
      { char: "🏀", name: "Basketball", keywords: ["sport", "hoops"] },
      { char: "🎾", name: "Tennis", keywords: ["sport", "racket"] },
      { char: "🩺", name: "Doctor", keywords: ["medical", "appointment", "health"] },
      { char: "💊", name: "Medication", keywords: ["pills", "pharmacy", "health"] },
      { char: "🦷", name: "Dentist", keywords: ["teeth", "appointment"] },
      { char: "😴", name: "Sleep", keywords: ["rest", "bedtime"] },
      { char: "🥗", name: "Eating well", keywords: ["salad", "diet", "healthy"] },
    ],
  },
  {
    id: "food",
    label: "Food",
    icons: [
      { char: "🍳", name: "Cooking", keywords: ["kitchen", "recipe", "meal"] },
      { char: "🛒", name: "Groceries", keywords: ["shopping", "supermarket", "food"] },
      { char: "🍽", name: "Meals", keywords: ["dinner", "eating", "restaurant"] },
      { char: "🍎", name: "Fruit", keywords: ["apple", "healthy", "snack"] },
      { char: "🥕", name: "Vegetables", keywords: ["carrot", "veg", "greens"] },
      { char: "🍞", name: "Baking", keywords: ["bread", "oven"] },
      { char: "☕", name: "Coffee", keywords: ["cafe", "morning", "break"] },
      { char: "🍵", name: "Tea", keywords: ["brew", "break"] },
      { char: "🍕", name: "Takeaway", keywords: ["pizza", "delivery", "fast food"] },
      { char: "🍰", name: "Baking treats", keywords: ["cake", "dessert", "sweet"] },
      { char: "🍷", name: "Drinks", keywords: ["wine", "bar", "evening"] },
      { char: "🧊", name: "Freezer", keywords: ["ice", "cold", "meal prep"] },
    ],
  },
  {
    id: "travel",
    label: "Travel",
    icons: [
      { char: "✈️", name: "Flights", keywords: ["plane", "travel", "trip"] },
      { char: "🧳", name: "Packing", keywords: ["luggage", "suitcase", "trip"] },
      { char: "🗺", name: "Trip planning", keywords: ["map", "itinerary", "route"] },
      { char: "🚗", name: "Driving", keywords: ["car", "road trip"] },
      { char: "🚆", name: "Trains", keywords: ["rail", "commute"] },
      { char: "🚌", name: "Bus", keywords: ["transit", "commute"] },
      { char: "🚲", name: "Bike", keywords: ["cycling", "commute"] },
      { char: "⛽", name: "Fuel", keywords: ["petrol", "gas", "car"] },
      { char: "🏨", name: "Hotels", keywords: ["stay", "booking", "accommodation"] },
      { char: "🎫", name: "Tickets", keywords: ["booking", "event", "entry"] },
      { char: "🏝", name: "Holiday", keywords: ["beach", "island", "vacation"] },
      { char: "⛺", name: "Camping", keywords: ["tent", "outdoors"] },
      { char: "🏔", name: "Mountains", keywords: ["hiking", "outdoors", "ski"] },
      { char: "🌍", name: "World", keywords: ["globe", "international", "abroad"] },
    ],
  },
  {
    id: "money",
    label: "Money",
    icons: [
      { char: "💰", name: "Money", keywords: ["cash", "savings", "budget"] },
      { char: "💳", name: "Card", keywords: ["payment", "spending", "credit"] },
      { char: "💵", name: "Cash", keywords: ["notes", "budget", "money"] },
      { char: "🪙", name: "Savings", keywords: ["coin", "invest", "pension"] },
      { char: "🏦", name: "Bank", keywords: ["account", "mortgage", "finance"] },
      { char: "📉", name: "Expenses", keywords: ["chart", "down", "costs"] },
      { char: "🏷", name: "Deals", keywords: ["price", "tag", "sale"] },
      { char: "💸", name: "Spending", keywords: ["budget", "outgoings", "bills"] },
    ],
  },
  {
    id: "nature",
    label: "Nature",
    icons: [
      { char: "🌱", name: "Growing", keywords: ["seedling", "start", "garden"] },
      { char: "🌳", name: "Tree", keywords: ["garden", "outdoors", "nature"] },
      { char: "🌸", name: "Blossom", keywords: ["flower", "spring"] },
      { char: "🍂", name: "Autumn", keywords: ["leaves", "fall", "season"] },
      { char: "☀️", name: "Sun", keywords: ["summer", "weather", "morning"] },
      { char: "🌙", name: "Night", keywords: ["moon", "evening", "sleep"] },
      { char: "⭐", name: "Star", keywords: ["favourite", "highlight", "special"] },
      { char: "⛅", name: "Weather", keywords: ["cloud", "forecast"] },
      { char: "❄️", name: "Winter", keywords: ["snow", "cold", "season"] },
      { char: "🔥", name: "Hot", keywords: ["fire", "streak", "urgent"] },
      { char: "🌊", name: "Water", keywords: ["sea", "wave", "ocean"] },
      { char: "🐟", name: "Fish", keywords: ["aquarium", "pet", "sea"] },
    ],
  },
  {
    id: "things",
    label: "Things",
    icons: [
      { char: "📱", name: "Phone", keywords: ["mobile", "apps", "device"] },
      { char: "🖥", name: "Computer", keywords: ["desktop", "setup", "device"] },
      { char: "🎧", name: "Audio", keywords: ["music", "podcast", "headphones"] },
      { char: "📷", name: "Photos", keywords: ["camera", "pictures"] },
      { char: "🎮", name: "Games", keywords: ["gaming", "console", "play"] },
      { char: "🎸", name: "Music", keywords: ["guitar", "practice", "band"] },
      { char: "🎨", name: "Art", keywords: ["design", "paint", "creative"] },
      { char: "🎬", name: "Film", keywords: ["video", "watch", "movies"] },
      { char: "📺", name: "TV", keywords: ["watch", "series", "shows"] },
      { char: "🔒", name: "Security", keywords: ["lock", "passwords", "private"] },
      { char: "🔋", name: "Power", keywords: ["battery", "energy", "charge"] },
      { char: "🛠", name: "Maintenance", keywords: ["tools", "fix", "upkeep"] },
    ],
  },
  {
    id: "symbols",
    label: "Symbols",
    icons: [
      // Not emoji, on purpose: these render in the row's own text colour, so
      // they read as typography beside the project's coloured ring.
      { char: "★", name: "Star", keywords: ["favourite", "symbol"] },
      { char: "●", name: "Dot", keywords: ["circle", "bullet", "symbol"] },
      { char: "◆", name: "Diamond", keywords: ["shape", "symbol"] },
      { char: "▲", name: "Triangle", keywords: ["shape", "up", "symbol"] },
      { char: "■", name: "Square", keywords: ["shape", "symbol"] },
      { char: "✦", name: "Sparkle", keywords: ["star", "shape", "symbol"] },
      { char: "✱", name: "Asterisk", keywords: ["star", "note", "symbol"] },
      { char: "✚", name: "Cross", keywords: ["plus", "add", "symbol"] },
      { char: "✓", name: "Check", keywords: ["tick", "done", "symbol"] },
      { char: "➜", name: "Arrow", keywords: ["next", "forward", "symbol"] },
      { char: "❯", name: "Chevron", keywords: ["arrow", "next", "symbol"] },
      { char: "⌘", name: "Command", keywords: ["key", "mac", "symbol"] },
      { char: "⚑", name: "Flag", keywords: ["mark", "symbol"] },
      { char: "∞", name: "Infinity", keywords: ["ongoing", "forever", "symbol"] },
      { char: "№", name: "Number", keywords: ["no", "index", "symbol"] },
      { char: "§", name: "Section", keywords: ["legal", "symbol"] },
    ],
  },
];

/** Every option, flattened — the search corpus and the "all" grid. */
export const PROJECT_ICONS: readonly ProjectIconOption[] =
  PROJECT_ICON_GROUPS.flatMap((g) => g.icons);

/**
 * Name-and-keyword search over the catalogue. A query that *is* a character
 * (someone pasted an emoji) returns it as its own result, so the picker can
 * offer to use anything the catalogue doesn't list.
 */
export function searchProjectIcons(query: string): readonly ProjectIconOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return PROJECT_ICONS;

  const matches = PROJECT_ICONS.filter(
    (icon) =>
      icon.char === query.trim() ||
      icon.name.toLowerCase().includes(q) ||
      (icon.keywords ?? []).some((k) => k.includes(q))
  );

  // A pasted glyph we don't stock is still a valid icon — offer it first. Only
  // when the query *is* that one glyph, though: a word being typed into the
  // search box must not read as an offer to use its first letter.
  const typed = normalizeProjectIcon(query);
  if (
    typed &&
    typed === query.trim() &&
    !matches.some((m) => m.char === typed)
  ) {
    return [{ char: typed, name: "Use this" }, ...matches];
  }
  return matches;
}

// ─── Reading one icon out of arbitrary text ─────────────
//
// The picker writes a known character, but the field beside it accepts typing
// and pasting, and "🙂 hello" or a full sentence must not reach the database.
// `Intl.Segmenter` would do this properly and is not dependable on Hermes, so
// the cluster rules emoji actually use are spelled out here instead.

const ZWJ = 0x200d;
const VARIATION_SELECTOR_15 = 0xfe0e;
const VARIATION_SELECTOR_16 = 0xfe0f;
const COMBINING_KEYCAP = 0x20e3;

const isSkinTone = (cp: number) => cp >= 0x1f3fb && cp <= 0x1f3ff;
const isRegionalIndicator = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const isTag = (cp: number) => cp >= 0xe0020 && cp <= 0xe007f;
const isCombiningMark = (cp: number) =>
  (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff);

/** Modifiers that attach to the character before them rather than standing alone. */
const isModifier = (cp: number) =>
  cp === VARIATION_SELECTOR_15 ||
  cp === VARIATION_SELECTOR_16 ||
  cp === COMBINING_KEYCAP ||
  isSkinTone(cp) ||
  isTag(cp) ||
  isCombiningMark(cp);

/**
 * The first grapheme cluster of `text` — one glyph as a reader sees it,
 * modifiers and ZWJ joins included. Returns "" for empty input.
 */
export function firstGrapheme(text: string): string {
  const points = Array.from(text);
  if (points.length === 0) return "";

  let i = 0;
  const take = () => {
    const base = points[i++];
    if (base === undefined) return;
    // A flag is a *pair* of regional indicators, and only a pair.
    if (isRegionalIndicator(base.codePointAt(0) ?? 0)) {
      const next = points[i];
      if (next && isRegionalIndicator(next.codePointAt(0) ?? 0)) i++;
      return;
    }
    while (i < points.length && isModifier(points[i]!.codePointAt(0) ?? 0)) i++;
  };

  take();
  // …then any number of ZWJ-joined pieces, each with its own modifiers.
  while (
    i + 1 < points.length &&
    (points[i]!.codePointAt(0) ?? 0) === ZWJ
  ) {
    i++; // the joiner
    take();
  }

  return points.slice(0, i).join("");
}

/**
 * What to store for whatever the user typed: a single glyph, or "" when there
 * isn't one that fits. A cluster longer than the column allows (the four-person
 * family, a subdivision flag) is dropped rather than truncated — half a ZWJ
 * sequence renders as two unrelated emoji.
 */
export function normalizeProjectIcon(raw: string): string {
  const glyph = firstGrapheme(raw.trim());
  if (!glyph) return "";
  if (glyph.length > PROJECT_ICON_MAX_LENGTH) return "";
  // Postgres counts code points; the client counts UTF-16 units. Satisfy both.
  if (Array.from(glyph).length > PROJECT_ICON_MAX_LENGTH) return "";
  return glyph;
}
