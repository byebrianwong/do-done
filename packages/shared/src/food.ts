import type { Task } from "./schemas.js";

/**
 * What aisle a thing to buy lives in, guessed from what it is called.
 *
 * ## Why a built-in lexicon is right here, having been wrong for projects
 *
 * `suggestCategories` in `packages/task-engine` is a keyword table mapping
 * "gym" to "Health", and the note beside it says it has been dead since it was
 * written — because a table like that is *a guess about a project list we can
 * see*, and it is wrong for everyone whose projects are named differently,
 * which is everyone.
 *
 * None of that applies to food. "Bananas" is produce in every household on
 * earth, this year and next, and the category set is a property of supermarkets
 * rather than of this user's filing scheme. There is nothing personal to learn,
 * so there is nothing a table can get wrong about *them* — only about the
 * language, which is a much smaller and much more stable problem. This is the
 * one place in DoDone where shipping a lexicon beats learning from history.
 *
 * The corollary is the honest limit: it knows groceries, in English. Everything
 * it does not recognise is uncategorised, which is a first-class state and not
 * a failure — see `groupByAisle`.
 */

// ── Aisles ─────────────────────────────────────────────

/**
 * The aisles, in the order a supermarket is usually walked: fresh round the
 * outside first, then the dry middle, then the non-food tail.
 *
 * This order is the whole point of grouping — a list sorted this way is a route
 * rather than an inventory. It is deliberately *one* order rather than a
 * per-store one: every supermarket differs, but they differ around this shape,
 * and a wrong-but-consistent order still beats no order at all. Per-store
 * ordering is a real follow-up and a separate decision.
 */
export const AISLES = [
  "produce",
  "bakery",
  "meat",
  "dairy",
  "frozen",
  "pantry",
  "snacks",
  "drinks",
  "household",
  "personal",
  "baby",
  "pets",
] as const;

export type Aisle = (typeof AISLES)[number];

export const AISLE_LABEL: Record<Aisle, string> = {
  produce: "Produce",
  bakery: "Bakery",
  meat: "Meat & fish",
  dairy: "Dairy & eggs",
  frozen: "Frozen",
  pantry: "Pantry",
  snacks: "Snacks",
  drinks: "Drinks",
  household: "Household",
  personal: "Personal care",
  baby: "Baby",
  pets: "Pets",
};

const AISLE_RANK: Record<Aisle, number> = AISLES.reduce(
  (acc, aisle, i) => {
    acc[aisle] = i;
    return acc;
  },
  {} as Record<Aisle, number>
);

/** True for a string that names an aisle. Guards values off the wire. */
export function isAisle(value: string | null | undefined): value is Aisle {
  return !!value && (AISLES as readonly string[]).includes(value);
}

// ── The lexicon ────────────────────────────────────────
//
// Written as plain word lists per aisle and compiled once below. Multi-word
// entries are allowed and are what disambiguate ("ice cream" is frozen, "ice"
// on its own is not food at all; "chicken stock" is pantry, "chicken" is meat).

const LEXICON: Record<Aisle, string[]> = {
  produce: [
    "apple", "apples", "avocado", "avocados", "banana", "bananas", "basil",
    "beetroot", "bell pepper", "berries", "blueberries", "broccoli",
    "brussels sprouts", "cabbage", "carrot", "carrots", "cauliflower",
    "celery", "cherries", "chilli", "cilantro", "coriander", "corn",
    "courgette", "cucumber", "dill", "aubergine", "eggplant", "garlic",
    "ginger", "grapes", "green beans", "kale", "leek", "lemon", "lemons",
    "lettuce", "lime", "limes", "mandarin", "mango", "melon", "mint",
    "mushroom", "mushrooms", "nectarine", "onion", "onions", "orange",
    "oranges", "parsley", "parsnip", "peach", "peaches", "pear", "pears",
    "peas", "pepper", "peppers", "pineapple", "plum", "plums", "potato",
    "potatoes", "pumpkin", "radish", "raspberries", "rocket", "rosemary",
    "salad", "scallions", "shallot", "spinach", "spring onions", "squash",
    "strawberries", "sweet potato", "thyme", "tomato", "tomatoes", "turnip",
    "watermelon", "zucchini", "herbs", "fruit", "vegetables", "veg",
  ],
  bakery: [
    "bagel", "bagels", "baguette", "bread", "brioche", "bun", "buns", "cake",
    "ciabatta", "croissant", "croissants", "crumpets", "doughnut", "donuts",
    "flatbread", "focaccia", "muffin", "muffins", "naan", "pastry", "pitta",
    "pita", "roll", "rolls", "scones", "sourdough", "tortilla", "tortillas",
    // Deliberately not "wrap": a tortilla wrap is reachable through
    // "tortilla", and the bare word belongs to gift wrap, cling wrap and
    // bubble wrap at least as often. A single-word entry has to be
    // unambiguous *across aisles* to earn its place — "Gift wrap" filed under
    // Bakery is the exact failure this rule exists to prevent.
  ],
  meat: [
    "anchovies", "bacon", "beef", "burgers", "chicken", "chorizo", "cod",
    "crab", "duck", "fish", "gammon", "ham", "haddock", "lamb", "liver",
    "mackerel", "meatballs", "mince", "mussels", "pancetta", "pepperoni",
    "pork", "prawns", "prosciutto", "salami", "salmon", "sardines",
    "sausage", "sausages", "scallops", "shrimp", "steak", "trout", "tuna",
    "turkey", "venison",
  ],
  dairy: [
    "brie", "butter", "buttermilk", "cheddar", "cheese", "cream",
    "cream cheese", "creme fraiche", "custard", "egg", "eggs", "feta",
    "ghee", "goats cheese", "halloumi", "kefir", "margarine", "mascarpone",
    "milk", "mozzarella", "oat milk", "parmesan", "ricotta", "skyr",
    "sour cream", "soy milk", "yoghurt", "yogurt", "almond milk",
    "double cream", "single cream", "whipping cream", "greek yoghurt",
    "greek yogurt", "cottage cheese",
  ],
  frozen: [
    "fish fingers", "frozen berries", "frozen peas", "frozen pizza",
    "ice cream", "ice lollies", "ice pops", "sorbet", "frozen chips",
    "frozen vegetables", "frozen veg", "waffles", "gelato",
  ],
  pantry: [
    "baking powder", "balsamic", "beans", "bicarbonate of soda",
    "black pepper", "bouillon", "breadcrumbs", "broth", "brown sugar",
    "canned tomatoes", "capers", "cereal", "chia seeds", "chicken stock",
    "chickpeas", "chopped tomatoes", "cocoa", "coconut milk", "coffee",
    "coffee beans", "cornflour", "cornstarch", "couscous", "curry paste",
    "curry powder", "flour", "granola", "honey", "hot sauce", "hummus",
    "jam", "ketchup", "lentils", "maple syrup", "marmalade", "mayonnaise",
    "mustard", "noodles", "nutella", "oats", "oil", "olive oil", "olives",
    "paprika", "passata", "pasta", "peanut butter", "pesto", "pickles",
    "porridge", "quinoa", "rice", "risotto rice", "salt", "sesame oil",
    "soup", "soy sauce", "spaghetti", "stock cubes", "sugar", "sultanas",
    "sunflower oil", "syrup", "tahini", "tea", "tea bags", "tinned tomatoes",
    "tomato puree", "tuna tins", "vanilla", "vinegar", "yeast", "stock",
    "spices", "seasoning", "raisins", "nuts", "almonds", "cashews",
    "walnuts", "peanuts", "sesame seeds", "sunflower seeds",
  ],
  snacks: [
    "biscuits", "cereal bars", "chocolate", "cookies", "crackers", "crisps",
    "chips", "flapjacks", "granola bars", "haribo", "popcorn", "pretzels",
    "protein bars", "sweets", "candy", "trail mix", "tortilla chips",
    "dark chocolate", "milk chocolate",
  ],
  drinks: [
    "apple juice", "beer", "cider", "cola", "cordial", "fizzy drinks",
    "gin", "juice", "lemonade", "orange juice", "prosecco", "sparkling water",
    "squash drink", "tonic", "water", "wine", "whisky", "vodka",
    "energy drink", "soda", "kombucha", "smoothie",
  ],
  household: [
    "aluminium foil", "batteries", "bin bags", "bleach", "candles",
    "cling film", "dish soap", "dishwasher tablets", "fabric softener",
    "foil", "j cloths", "kitchen roll", "laundry detergent", "light bulbs",
    "matches", "paper towels", "sponges", "surface spray", "tin foil",
    "tissues", "toilet paper", "toilet roll", "washing up liquid",
    "washing powder", "bin liners", "cleaner", "detergent", "gift wrap",
    "wrapping paper", "cling wrap", "plastic wrap", "sponge",
  ],
  personal: [
    "body wash", "conditioner", "cotton buds", "deodorant", "floss",
    "hand soap", "ibuprofen", "moisturiser", "mouthwash", "paracetamol",
    "plasters", "razors", "shampoo", "shaving foam", "shower gel",
    "soap", "sunscreen", "tampons", "toothbrush", "toothpaste",
    "vitamins", "painkillers", "sanitary pads", "contact solution",
  ],
  baby: [
    "baby food", "baby wipes", "formula", "nappies", "diapers",
    "baby shampoo", "dummies", "pacifier",
  ],
  pets: [
    "cat food", "cat litter", "dog food", "dog treats", "pet food",
    "birdseed", "litter",
  ],
};

/** phrase → aisle, and the longest phrase in it (in words). */
const { table: PHRASES, maxWords: MAX_PHRASE_WORDS } = (() => {
  const table = new Map<string, Aisle>();
  let maxWords = 1;
  for (const aisle of AISLES) {
    for (const term of LEXICON[aisle]) {
      const key = normalize(term);
      if (!key) continue;
      // First writer wins, so an earlier aisle owns a term two lists share.
      if (!table.has(key)) table.set(key, aisle);
      maxWords = Math.max(maxWords, key.split(" ").length);
    }
  }
  return { table, maxWords };
})();

/** Lowercase, alphanumerics and single spaces. Same shape as `matchProject`. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Other spellings of a word to try when it isn't in the table as written.
 *
 * Both directions, because the lexicon is written the way people write shopping
 * lists and that isn't consistent: "candles" is listed plural (you buy several)
 * and "sourdough" singular (you buy a loaf), so a match has to survive the user
 * writing the other one. "Scented candle" missing Household because the list
 * happened to say "candles" is the sort of gap nobody would ever find by
 * reading the lexicon.
 *
 * Length-guarded so three-letter noise can't be inflected into a false hit.
 */
function variants(word: string): string[] {
  if (word.length < 4) return [];
  const out: string[] = [];
  if (word.endsWith("ies")) out.push(`${word.slice(0, -3)}y`);
  else if (
    word.endsWith("ses") ||
    word.endsWith("xes") ||
    word.endsWith("hes")
  ) {
    out.push(word.slice(0, -2));
  } else if (word.endsWith("s")) out.push(word.slice(0, -1));
  else {
    out.push(`${word}s`);
    if (word.endsWith("y")) out.push(`${word.slice(0, -1)}ies`);
    if (/(s|x|ch|sh)$/.test(word)) out.push(`${word}es`);
  }
  return out;
}

/**
 * The aisle a written item belongs to, or null when nothing is recognised.
 *
 * Two rules decide between competing matches, and the second is the
 * interesting one:
 *
 * 1. **The longest phrase wins.** "ice cream" beats "cream", "chicken stock"
 *    beats "chicken", "coffee beans" beats both "coffee" and "beans".
 * 2. **Between equal-length matches, the one furthest right wins**, because an
 *    English noun compound is head-final: the last noun says what the thing
 *    *is* and the ones before it modify it. That single rule gets both
 *    "chocolate milk" (dairy) and "milk chocolate" (snacks) correct, which no
 *    amount of first-match scanning would.
 */
export function categorizeItem(title: string): Aisle | null {
  const words = normalize(title).split(" ").filter(Boolean);
  if (words.length === 0) return null;

  let best: { aisle: Aisle; length: number; end: number } | null = null;

  for (let start = 0; start < words.length; start++) {
    const maxLen = Math.min(MAX_PHRASE_WORDS, words.length - start);
    for (let len = maxLen; len >= 1; len--) {
      const slice = words.slice(start, start + len);
      let aisle = PHRASES.get(slice.join(" "));

      // Re-spell only the head word, and only for a phrase that missed as
      // written. "green beans" is in the table; "carrots" isn't but "carrot"
      // is, and "candle" isn't but "candles" is.
      if (!aisle) {
        for (const head of variants(slice[slice.length - 1]!)) {
          aisle = PHRASES.get([...slice.slice(0, -1), head].join(" "));
          if (aisle) break;
        }
      }
      if (!aisle) continue;

      const end = start + len;
      if (
        !best ||
        len > best.length ||
        (len === best.length && end > best.end)
      ) {
        best = { aisle, length: len, end };
      }
      // Nothing shorter starting here can beat what we just found.
      break;
    }
  }

  return best?.aisle ?? null;
}

// ── Overrides ──────────────────────────────────────────
//
// Same mechanism as the store hint in `lists.ts`, and for the same reasons: a
// reserved tag prefix rides through every capture surface, the parser and MCP
// without a column that would be null on every task in the app.

export const AISLE_TAG_PREFIX = "aisle:";

/** The user's correction for this item, if they made one. */
export function aisleOverride(task: Pick<Task, "tags">): Aisle | null {
  for (const tag of task.tags ?? []) {
    if (tag.startsWith(AISLE_TAG_PREFIX)) {
      const value = tag.slice(AISLE_TAG_PREFIX.length).trim();
      if (isAisle(value)) return value;
    }
  }
  return null;
}

export function aisleTag(aisle: Aisle): string {
  return `${AISLE_TAG_PREFIX}${aisle}`;
}

/** Replace an item's aisle correction, preserving every other tag. */
export function withAisle(tags: string[], aisle: Aisle | null): string[] {
  const rest = tags.filter((t) => !t.startsWith(AISLE_TAG_PREFIX));
  return aisle ? [...rest, aisleTag(aisle)] : rest;
}

// ── Memory ─────────────────────────────────────────────

/**
 * What the user has taught DoDone about their own words: normalised item text
 * → aisle. Loaded once per session and passed in, the same way `matchProject`
 * takes the project list rather than reaching for one.
 */
export type AisleMemory = ReadonlyMap<string, Aisle>;

/** Leading count, unit or article — "6 ", "500 g ", "2 x ", "a ". */
const QUANTITY_PREFIX =
  /^(?:\d+(?:\.\d+)?\s*(?:x|kg|g|lb|lbs|oz|ml|l|litres?|liters?|packs?|tins?|cans?|boxes?|bottles?|bunch(?:es)?|dozen)?\s+)?(?:of\s+)?(?:a|an|the|some)?\s*/;

/** Longest key we will store. It is an index, not content. */
export const AISLE_TERM_MAX_LENGTH = 120;

/**
 * The key a lesson is filed under: the item's text, normalised, with a leading
 * quantity stripped. Null when nothing usable is left.
 *
 * **Deliberately the whole title rather than a head word.** Learning "milk"
 * from a correction to "chocolate milk" would be a guess about which word
 * carried the user's intent, and it would be wrong exactly when it mattered —
 * quietly re-filing every other milk on the list. Keying on what they actually
 * wrote can only ever under-generalise, which costs one more correction;
 * over-generalising costs trust in the grouping.
 *
 * The quantity strip is the one concession, because "6 eggs" and "eggs" are
 * obviously the same lesson and nobody writes the number consistently.
 */
export function learnableTerm(title: string): string | null {
  const normalized = normalize(title);
  if (!normalized) return null;
  const stripped = normalized.replace(QUANTITY_PREFIX, "").trim();
  const term = (stripped || normalized).slice(0, AISLE_TERM_MAX_LENGTH).trim();
  return term || null;
}

/**
 * The aisle an item is actually filed under, most specific answer first:
 *
 * 1. **This row's own correction** — the user just touched it.
 * 2. **What they taught us about these words** before, on some other row.
 * 3. **The lexicon's guess.**
 *
 * A correction always wins, and there is no confidence threshold that could
 * overturn it — the lexicon is a guess about the language and the user is
 * looking at the shelf.
 */
export function itemAisle(
  task: Pick<Task, "title" | "tags">,
  memory?: AisleMemory
): Aisle | null {
  const own = aisleOverride(task);
  if (own) return own;
  if (memory?.size) {
    const term = learnableTerm(task.title);
    const learned = term ? memory.get(term) : undefined;
    if (learned) return learned;
  }
  return categorizeItem(task.title);
}

// ── Grouping ───────────────────────────────────────────

export interface AisleGroup<T> {
  /** null for the tail of items nothing recognised. */
  aisle: Aisle | null;
  label: string;
  items: T[];
}

/**
 * Below this many items a list renders flat, headers and all suppressed.
 *
 * Four things do not need a route through them, and three headers over five
 * rows is more furniture than list. The rule matters most on a list that is
 * *nearly* empty at the end of a shop, where grouping would otherwise leave
 * one item marooned under its own heading.
 */
export const AISLE_GROUP_MIN_ITEMS = 6;

/**
 * Group items into aisles, in walking order, with the unrecognised tail last.
 *
 * Returns a single unlabelled group when there is nothing to gain — too few
 * items, or every item landing in the same place — so a caller can render the
 * result unconditionally and get a flat list exactly when a flat list is right.
 * That is what keeps "the lexicon knows none of these words" from looking like
 * a broken feature: it looks like the plain list it always was.
 */
export function groupByAisle<T extends Pick<Task, "title" | "tags">>(
  items: T[],
  opts: { minItems?: number; memory?: AisleMemory } = {}
): AisleGroup<T>[] {
  const flat = (): AisleGroup<T>[] => [{ aisle: null, label: "", items }];
  const min = opts.minItems ?? AISLE_GROUP_MIN_ITEMS;
  if (items.length < min) return flat();

  const buckets = new Map<Aisle | null, T[]>();
  for (const item of items) {
    const aisle = itemAisle(item, opts.memory);
    const bucket = buckets.get(aisle);
    if (bucket) bucket.push(item);
    else buckets.set(aisle, [item]);
  }

  // One bucket is not a grouping, whether it's "all produce" or "all unknown".
  if (buckets.size < 2) return flat();

  const groups: AisleGroup<T>[] = [];
  for (const aisle of AISLES) {
    const bucket = buckets.get(aisle);
    if (bucket?.length) {
      groups.push({ aisle, label: AISLE_LABEL[aisle], items: bucket });
    }
  }
  const rest = buckets.get(null);
  if (rest?.length) {
    // "Other", never "Uncategorised": the user did not fail to categorise
    // anything, the lexicon did.
    groups.push({ aisle: null, label: "Other", items: rest });
  }
  return groups;
}

/** Aisles in walking order — for a picker offering a correction. */
export function aisleOptions(): Array<{ value: Aisle; label: string }> {
  return [...AISLES]
    .sort((a, b) => AISLE_RANK[a] - AISLE_RANK[b])
    .map((value) => ({ value, label: AISLE_LABEL[value] }));
}
