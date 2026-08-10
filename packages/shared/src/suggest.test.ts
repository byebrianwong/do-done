import { describe, it, expect } from "vitest";
import {
  buildSuggestionIndex,
  emptySuggestionIndex,
  suggestFacets,
  suggestionTokens,
  type SuggestionRow,
} from "./suggest.js";

const WORK = "proj-work";
const HOME = "proj-home";

/** Pad the history past MIN_HISTORY_ROWS with titles that share no tokens. */
function padding(n: number): SuggestionRow[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `unrelated filler alpha${i}`,
    project_id: null,
    duration_minutes: null,
  }));
}

function history(...rows: SuggestionRow[]): SuggestionRow[] {
  return [...rows, ...padding(12)];
}

function task(
  title: string,
  project_id: string | null = null,
  duration_minutes: number | null = null
): SuggestionRow {
  return { title, project_id, duration_minutes };
}

describe("suggestionTokens", () => {
  it("drops function words, short words and bare numbers", () => {
    expect(suggestionTokens("Send the report to 2 clients")).toEqual([
      "send",
      "report",
      "clients",
    ]);
  });

  it("keeps the leading verb — it is the strongest signal, not noise", () => {
    expect(suggestionTokens("buy milk")).toEqual(["buy", "milk"]);
  });

  it("splits punctuation and shortcut syntax into their word halves", () => {
    expect(suggestionTokens("standup #work ~1h")).toEqual(["standup", "work"]);
  });

  it("de-duplicates, so a repeated word votes once", () => {
    expect(suggestionTokens("email vendor about email")).toEqual(["email", "vendor"]);
  });
});

describe("suggestFacets — project", () => {
  it("suggests the project a repeated word has always gone to", () => {
    const index = buildSuggestionIndex(
      history(
        task("standup notes", WORK),
        task("standup agenda", WORK),
        task("prep standup", WORK)
      )
    );
    const { project_id } = suggestFacets("standup follow-up", index);
    expect(project_id?.value).toBe(WORK);
    expect(project_id?.because).toContain("standup");
    expect(project_id?.confidence).toBe(1);
  });

  it("stays silent when the same word has gone both ways", () => {
    const index = buildSuggestionIndex(
      history(
        task("email mum", HOME),
        task("email dad", HOME),
        task("email client", WORK),
        task("email vendor", WORK)
      )
    );
    expect(suggestFacets("email someone", index).project_id).toBeNull();
  });

  it("lets a second word break a tie the first cannot", () => {
    const index = buildSuggestionIndex(
      history(
        task("email mum", HOME),
        task("email dad", HOME),
        task("email client", WORK),
        task("email vendor", WORK),
        task("call vendor", WORK),
        task("chase vendor", WORK)
      )
    );
    const { project_id } = suggestFacets("email vendor again", index);
    expect(project_id?.value).toBe(WORK);
    expect(project_id?.because).toEqual(["email", "vendor"]);
  });

  it("ignores a word seen only once — one coincidence is not evidence", () => {
    const index = buildSuggestionIndex(history(task("renew passport", HOME)));
    expect(suggestFacets("renew passport", index).project_id).toBeNull();
  });

  it("says nothing at all until there is a history to say it from", () => {
    const index = buildSuggestionIndex([
      task("standup notes", WORK),
      task("standup agenda", WORK),
    ]);
    expect(suggestFacets("standup", index).project_id).toBeNull();
    expect(suggestFacets("standup", emptySuggestionIndex()).project_id).toBeNull();
  });

  it("never suggests a project that no longer exists", () => {
    const index = buildSuggestionIndex(
      history(task("standup notes", WORK), task("standup agenda", WORK))
    );
    expect(suggestFacets("standup", index, { projectIds: [WORK] }).project_id?.value).toBe(
      WORK
    );
    expect(suggestFacets("standup", index, { projectIds: [HOME] }).project_id).toBeNull();
  });

  it("is not swayed by a project simply being the biggest", () => {
    // Work has far more tasks, but none of them carry the typed word.
    const index = buildSuggestionIndex(
      history(
        ...Array.from({ length: 20 }, (_, i) => task(`ship feature${i} review`, WORK)),
        task("water plants", HOME),
        task("water garden", HOME)
      )
    );
    expect(suggestFacets("water the herbs", index).project_id?.value).toBe(HOME);
  });
});

describe("suggestFacets — estimate", () => {
  it("suggests the duration that kind of task has taken", () => {
    const index = buildSuggestionIndex(
      history(
        task("weekly review", WORK, 60),
        task("monthly review", WORK, 60),
        task("quarterly review", WORK, 60)
      )
    );
    expect(suggestFacets("annual review", index).duration_minutes?.value).toBe(60);
  });

  it("stays silent when the same word has taken wildly different times", () => {
    const index = buildSuggestionIndex(
      history(
        task("write blog post", null, 240),
        task("write standup note", null, 15),
        task("write invoice", null, 30),
        task("write brief", null, 120)
      )
    );
    expect(suggestFacets("write something", index).duration_minutes).toBeNull();
  });

  it("is independent of the project suggestion", () => {
    // The word is decisive about the project and says nothing about duration.
    const index = buildSuggestionIndex(
      history(task("standup notes", WORK), task("standup agenda", WORK))
    );
    const out = suggestFacets("standup", index);
    expect(out.project_id?.value).toBe(WORK);
    expect(out.duration_minutes).toBeNull();
  });
});

describe("suggestFacets — the asymmetry it is tuned on", () => {
  it("returns nothing for an empty or wordless title", () => {
    const index = buildSuggestionIndex(
      history(task("standup notes", WORK), task("standup agenda", WORK))
    );
    expect(suggestFacets("", index).project_id).toBeNull();
    expect(suggestFacets("   ", index).project_id).toBeNull();
    expect(suggestFacets("42 !!", index).project_id).toBeNull();
  });

  it("tolerates rows with empty titles and no facets at all", () => {
    const index = buildSuggestionIndex(history(task(""), task("   "), task("ok")));
    expect(() => suggestFacets("anything", index)).not.toThrow();
  });
});
