/**
 * Guessing a task's project and estimate from the words in its title.
 *
 * **The training set is the user's own task list, and nothing else.** There is
 * no keyword table here and there must never be one: a hard-coded map from
 * "gym" to "Health" is a guess about a *project list we can see*, and it is
 * wrong for everyone whose projects are named differently — which is everyone.
 * What the history says instead is checkable ("the last four tasks with the
 * word `standup` went to Work"), which is also what makes a suggestion
 * explainable to the person reading it.
 *
 * Two calls rather than one, because they run at different rates: the index is
 * built once per session from a sweep of the rows, and {@link suggestFacets}
 * runs on every keystroke against it.
 *
 * ## Why only project and estimate
 *
 * `tasks.priority` is `not null default 'p4'`, so the history cannot tell
 * "chose Low" from "never triaged" — the same collapse that makes P4 draw
 * nothing in the row gutter. A frequency model over that column would suggest
 * `p4` for nearly everything, which is a suggestion in form only. `scheduled_date`
 * is worse: a date is about *when you are*, not about what the words say, and
 * the parser already reads "friday" out of the title far more reliably than a
 * frequency count ever could. Both are deliberately absent, and adding either
 * needs a reason beyond "the column exists".
 */

/** The columns a suggestion is built from. A whole `Task` satisfies it. */
export interface SuggestionRow {
  title: string;
  project_id: string | null;
  duration_minutes: number | null;
}

/**
 * One guess, with everything a UI needs to present it *as* a guess.
 *
 * `because` is not decoration. A suggested value the user cannot account for is
 * indistinguishable from a bug, and this is the whole of the explanation:
 * these words in the title are the ones that pointed here.
 */
export interface FacetSuggestion<T> {
  value: T;
  /** Share of the evidence that pointed at `value`, 0..1. */
  confidence: number;
  /** The title words that produced it, in the order they were typed. */
  because: string[];
}

export interface FacetSuggestions {
  project_id: FacetSuggestion<string> | null;
  duration_minutes: FacetSuggestion<number> | null;
}

/**
 * Pre-counted history. Opaque by intent — the shape is an implementation
 * detail of the scorer, and callers only ever hand it back to
 * {@link suggestFacets}.
 */
export interface SuggestionIndex {
  /** token → project id → how many titles carrying that token were filed there. */
  projectByToken: Map<string, Map<string, number>>;
  /** token → duration → how many titles carrying that token were estimated so. */
  durationByToken: Map<string, Map<number, number>>;
  /** How many rows the index was built from, project-bearing or not. */
  rowCount: number;
}

/**
 * Words that carry no information about which project a task belongs to.
 *
 * Deliberately only function words. The verbs that start a task title — buy,
 * call, email, fix, book — look like noise and are the opposite: they are the
 * single most discriminating signal in a task list, because the kind of verb a
 * task takes is most of what decides which project it is.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "then", "than",
  "you", "your", "our", "out", "into", "onto", "off", "about", "after",
  "before", "all", "any", "are", "was", "were", "have", "has", "had",
  "not", "but", "get", "got", "its", "his", "her", "their", "them",
  "when", "what", "who", "how", "why", "some", "more", "one", "two",
  "new", "old", "own", "via", "per", "etc",
]);

/** Shortest token worth counting. Two letters are almost all function words. */
const MIN_TOKEN_LENGTH = 3;

/**
 * How many historical titles must carry a token before it may vote.
 *
 * At 1 a token seen exactly once scores a perfect 1.0 for whichever project
 * that single task happened to be in — maximum confidence from a single
 * coincidence, which is the classic way a frequency model embarrasses itself.
 */
const MIN_TOKEN_SUPPORT = 2;

/** Below this many rows the history isn't a history, and nothing is suggested. */
const MIN_HISTORY_ROWS = 10;

/**
 * Minimum summed evidence for the winner. One token that has *always* gone to
 * a project scores 1.0; so do two that go there half the time. Below that the
 * signal is one ambiguous word and the chip should stay empty.
 */
const MIN_SUPPORT = 1;

/**
 * Minimum share of the evidence the winner must hold.
 *
 * A title whose words point two ways is exactly the case where a suggestion is
 * most expensive: it is the moment the user would have thought about it, and a
 * confident-looking wrong chip is what stops them. Ties resolve to silence.
 */
const MIN_CONFIDENCE = 0.6;

/**
 * The comparable words in a title.
 *
 * Split on anything that isn't a letter or a digit, so `#tags`, punctuation and
 * the `~1h` estimate syntax fall apart into their word halves rather than
 * forming tokens of their own. Numbers alone are dropped — "2" says nothing
 * about a project, and dates have already been read out by the parser.
 */
export function suggestionTokens(title: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < MIN_TOKEN_LENGTH) continue;
    if (!/[a-z]/.test(raw)) continue;
    if (STOPWORDS.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

function bump<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * Count a set of past tasks into the shape {@link suggestFacets} reads.
 *
 * Finished tasks count. A task filed in Work last month still says that the
 * word "standup" means Work, and dropping them would make the index forget
 * precisely the tasks the user has most experience of.
 */
export function buildSuggestionIndex(
  rows: readonly SuggestionRow[]
): SuggestionIndex {
  const projectByToken = new Map<string, Map<string, number>>();
  const durationByToken = new Map<string, Map<number, number>>();

  for (const row of rows) {
    const tokens = suggestionTokens(row.title ?? "");
    if (tokens.length === 0) continue;

    for (const token of tokens) {
      if (row.project_id) {
        let perProject = projectByToken.get(token);
        if (!perProject) projectByToken.set(token, (perProject = new Map()));
        bump(perProject, row.project_id);
      }
      if (row.duration_minutes) {
        let perDuration = durationByToken.get(token);
        if (!perDuration) durationByToken.set(token, (perDuration = new Map()));
        bump(perDuration, row.duration_minutes);
      }
    }
  }

  return { projectByToken, durationByToken, rowCount: rows.length };
}

/** An index over nothing — what a surface with no history to hand passes. */
export function emptySuggestionIndex(): SuggestionIndex {
  return { projectByToken: new Map(), durationByToken: new Map(), rowCount: 0 };
}

/**
 * Score one facet: every qualifying token splits one vote across the values it
 * has been seen with, so a word that always means the same thing carries a
 * whole vote and a word that means four things carries a quarter each.
 *
 * That normalisation is the point. Without it the winner is whichever value has
 * the most tasks overall, which is a suggestion that ignores the title.
 */
function scoreFacet<V>(
  tokens: readonly string[],
  byToken: Map<string, Map<V, number>>,
  allow?: (value: V) => boolean
): FacetSuggestion<V> | null {
  const scores = new Map<V, number>();
  const evidence = new Map<V, string[]>();

  for (const token of tokens) {
    const perValue = byToken.get(token);
    if (!perValue) continue;

    let total = 0;
    for (const [value, n] of perValue) {
      if (allow && !allow(value)) continue;
      total += n;
    }
    if (total < MIN_TOKEN_SUPPORT) continue;

    for (const [value, n] of perValue) {
      if (allow && !allow(value)) continue;
      scores.set(value, (scores.get(value) ?? 0) + n / total);
      const words = evidence.get(value);
      if (words) words.push(token);
      else evidence.set(value, [token]);
    }
  }

  if (scores.size === 0) return null;

  let best: V | undefined;
  let bestScore = 0;
  let sum = 0;
  for (const [value, score] of scores) {
    sum += score;
    if (score > bestScore) {
      bestScore = score;
      best = value;
    }
  }

  if (best === undefined || bestScore < MIN_SUPPORT) return null;
  const confidence = bestScore / sum;
  if (confidence < MIN_CONFIDENCE) return null;

  return { value: best, confidence, because: evidence.get(best) ?? [] };
}

export interface SuggestFacetsOptions {
  /**
   * The projects that still exist. A suggestion naming a deleted or archived
   * project is worse than none: the chip would show a name nothing in the app
   * can reach, and accepting it would file the task out of sight.
   */
  projectIds?: readonly string[];
}

/**
 * What the history says about a title being typed right now.
 *
 * Returns nulls freely and on purpose. This is a *suggestion*, competing
 * against a user who already knows where their task goes — the cost of being
 * silent is one chip tap, and the cost of being confidently wrong is a task
 * filed somewhere they will not look. Every threshold above is set on that
 * asymmetry.
 *
 * Pass the title the parser produced, not the raw input: a `#token` the user
 * has already typed is an explicit answer that outranks anything here, and
 * feeding it back in would have the history agreeing with a decision already
 * made.
 */
export function suggestFacets(
  title: string,
  index: SuggestionIndex,
  options: SuggestFacetsOptions = {}
): FacetSuggestions {
  const none: FacetSuggestions = { project_id: null, duration_minutes: null };
  if (index.rowCount < MIN_HISTORY_ROWS) return none;

  const tokens = suggestionTokens(title);
  if (tokens.length === 0) return none;

  const live = options.projectIds ? new Set(options.projectIds) : null;

  return {
    project_id: scoreFacet(
      tokens,
      index.projectByToken,
      live ? (id) => live.has(id) : undefined
    ),
    duration_minutes: scoreFacet(tokens, index.durationByToken),
  };
}
