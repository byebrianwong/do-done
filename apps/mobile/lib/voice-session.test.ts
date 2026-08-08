import { describe, expect, it } from "vitest";
import {
  applyResult,
  EMPTY_TRANSCRIPT,
  isSessionComplete,
  normalizeLevel,
  recognitionErrorMessage,
  transcriptText,
  type TranscriptState,
} from "./voice-session";

const result = (transcript: string, isFinal: boolean) => ({
  isFinal,
  results: [{ transcript }],
});

describe("applyResult", () => {
  it("shows a partial without committing it", () => {
    const state = applyResult(EMPTY_TRANSCRIPT, result("buy mil", false));
    expect(state).toEqual({ committed: "", partial: "buy mil" });
    expect(transcriptText(state)).toBe("buy mil");
  });

  it("replaces the partial as the guess improves", () => {
    let state = applyResult(EMPTY_TRANSCRIPT, result("buy mil", false));
    state = applyResult(state, result("buy milk", false));
    expect(transcriptText(state)).toBe("buy milk");
  });

  it("drops the partial once the utterance is final", () => {
    let state = applyResult(EMPTY_TRANSCRIPT, result("buy mil", false));
    state = applyResult(state, result("buy milk", true));
    expect(state).toEqual({ committed: "buy milk", partial: "" });
  });

  it("appends a recogniser that emits one segment per utterance (Android)", () => {
    let state = applyResult(EMPTY_TRANSCRIPT, result("buy milk", true));
    state = applyResult(state, result("and bread", true));
    expect(transcriptText(state)).toBe("buy milk and bread");
  });

  it("replaces a recogniser that re-sends everything each time (iOS)", () => {
    // Appending here would stutter: "buy milk buy milk and bread".
    let state = applyResult(EMPTY_TRANSCRIPT, result("buy milk", true));
    state = applyResult(state, result("buy milk and bread", true));
    expect(transcriptText(state)).toBe("buy milk and bread");
  });

  it("keeps a trailing partial alongside committed text", () => {
    // Android's last partial is sometimes all there is when a recognition is
    // cut short, so it has to survive into the text the caller reads.
    let state = applyResult(EMPTY_TRANSCRIPT, result("buy milk", true));
    state = applyResult(state, result("and bre", false));
    expect(transcriptText(state)).toBe("buy milk and bre");
  });

  it("survives an empty or malformed event", () => {
    const state: TranscriptState = { committed: "buy milk", partial: "" };
    expect(applyResult(state, { isFinal: true, results: [] })).toEqual(state);
    expect(applyResult(state, { isFinal: true })).toEqual(state);
    expect(applyResult(state, { isFinal: false, results: [{}] })).toEqual({
      committed: "buy milk",
      partial: "",
    });
  });

  it("trims the recogniser's stray whitespace", () => {
    const state = applyResult(EMPTY_TRANSCRIPT, result("  buy milk  ", true));
    expect(state.committed).toBe("buy milk");
  });
});

describe("normalizeLevel", () => {
  it("maps the recogniser's range onto 0..1", () => {
    expect(normalizeLevel(0)).toBe(0);
    expect(normalizeLevel(5)).toBe(0.5);
    expect(normalizeLevel(10)).toBe(1);
  });

  it("treats anything inaudible as silence rather than a live meter", () => {
    expect(normalizeLevel(-2)).toBe(0);
    expect(normalizeLevel(-0.5)).toBe(0);
  });

  it("clamps above the top of the range", () => {
    expect(normalizeLevel(40)).toBe(1);
  });

  it("is silent for a missing reading", () => {
    expect(normalizeLevel(NaN)).toBe(0);
    expect(normalizeLevel(Infinity)).toBe(0);
  });
});

describe("isSessionComplete", () => {
  it("waits for both the recogniser and the audio file", () => {
    // Handing over on `end` alone can ship a half-written WAV — a bug that
    // reproduces on one phone and not another.
    expect(isSessionComplete({ ended: false, audioClosed: false })).toBe(false);
    expect(isSessionComplete({ ended: true, audioClosed: false })).toBe(false);
    expect(isSessionComplete({ ended: false, audioClosed: true })).toBe(false);
    expect(isSessionComplete({ ended: true, audioClosed: true })).toBe(true);
  });
});

describe("recognitionErrorMessage", () => {
  it("says nothing when the user cancelled", () => {
    expect(recognitionErrorMessage("aborted")).toBeNull();
  });

  it("tells the user the audio survived an unrecognised recording", () => {
    expect(recognitionErrorMessage("no-speech")).toContain("still attached");
  });

  it("names the permission that is missing", () => {
    expect(recognitionErrorMessage("not-allowed")).toContain("microphone");
    expect(recognitionErrorMessage("service-not-allowed")).toContain("microphone");
  });

  it("has a sentence for an unknown code rather than a blank", () => {
    expect(recognitionErrorMessage("something-new")).toBe(
      "Couldn't transcribe that."
    );
  });
});
