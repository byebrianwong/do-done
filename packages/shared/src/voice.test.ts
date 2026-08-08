import { describe, expect, it } from "vitest";
import {
  appendTranscript,
  formatRecordingTime,
  isVoiceNoteFileName,
  splitTranscript,
  voiceNoteFileName,
  VOICE_TITLE_MAX_CHARS,
} from "./voice.js";

describe("splitTranscript", () => {
  it("keeps a short unpunctuated utterance whole", () => {
    // The common Android case: one run of text, no punctuation, short. It must
    // survive untouched so the quick-add parser still sees "tomorrow".
    expect(splitTranscript("buy milk tomorrow")).toEqual({
      title: "buy milk tomorrow",
      description: null,
    });
  });

  it("returns an empty title for empty or whitespace input", () => {
    expect(splitTranscript("")).toEqual({ title: "", description: null });
    expect(splitTranscript("   \n ")).toEqual({ title: "", description: null });
  });

  it("collapses the whitespace a long dictation leaves behind", () => {
    expect(splitTranscript("  buy   milk\n  tomorrow ").title).toBe(
      "buy milk tomorrow"
    );
  });

  it("splits at the first sentence and drops its full stop", () => {
    expect(
      splitTranscript("Renew the car insurance. The quote is on the fridge.")
    ).toEqual({
      title: "Renew the car insurance",
      description: "The quote is on the fridge.",
    });
  });

  it("treats a sole trailing full stop as punctuation, not a split", () => {
    expect(splitTranscript("Renew the car insurance.")).toEqual({
      title: "Renew the car insurance",
      description: null,
    });
  });

  it("handles ? and ! and the ellipsis the same way", () => {
    expect(splitTranscript("Did we pay the bill? Check with Sam.")).toEqual({
      title: "Did we pay the bill",
      description: "Check with Sam.",
    });
    expect(splitTranscript("Book the flights! Prices go up Friday.")).toEqual({
      title: "Book the flights",
      description: "Prices go up Friday.",
    });
  });

  it("does not split on an abbreviation's full stop", () => {
    // "Call Dr" is two words — believing that boundary would title the task
    // with half a name, so the split moves to the next real sentence end.
    expect(
      splitTranscript("Call Dr. Reed about the referral. Before Thursday.")
    ).toEqual({
      title: "Call Dr. Reed about the referral",
      description: "Before Thursday.",
    });
  });

  it("keeps an unpunctuated single-sentence dictation whole up to the ceiling", () => {
    const text = "a".repeat(VOICE_TITLE_MAX_CHARS);
    expect(splitTranscript(text)).toEqual({ title: text, description: null });
  });

  it("cuts an over-long unpunctuated dictation at a word boundary", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`);
    const { title, description } = splitTranscript(words.join(" "));

    expect(title.length).toBeLessThanOrEqual(VOICE_TITLE_MAX_CHARS);
    // Nothing is lost and nothing is chopped mid-word: the two halves rejoin
    // into exactly the input.
    expect(`${title} ${description}`).toBe(words.join(" "));
    expect(title.endsWith("word")).toBe(false);
  });

  it("falls back to length when the first sentence is itself too long", () => {
    const long = `${"x".repeat(VOICE_TITLE_MAX_CHARS + 20)} tail. And more.`;
    const { title, description } = splitTranscript(long);
    expect(title.length).toBeGreaterThan(0);
    expect(description).not.toBeNull();
  });

  it("keeps a single word longer than the ceiling whole rather than slicing it", () => {
    const beast = "x".repeat(VOICE_TITLE_MAX_CHARS + 30);
    expect(splitTranscript(`${beast} and then some`)).toEqual({
      title: beast,
      description: "and then some",
    });
    expect(splitTranscript(beast)).toEqual({ title: beast, description: null });
  });
});

describe("appendTranscript", () => {
  it("is the transcript alone when there was no description", () => {
    expect(appendTranscript(null, "Ask about the warranty")).toBe(
      "Ask about the warranty"
    );
    expect(appendTranscript("", "Ask about the warranty")).toBe(
      "Ask about the warranty"
    );
  });

  it("separates additions with a blank line so Markdown stays two paragraphs", () => {
    expect(appendTranscript("First note", "Second note")).toBe(
      "First note\n\nSecond note"
    );
  });

  it("does not stack blank lines on a description that already ends in one", () => {
    expect(appendTranscript("First note\n\n", "Second")).toBe(
      "First note\n\nSecond"
    );
  });

  it("leaves the description untouched when nothing was said", () => {
    expect(appendTranscript("First note", "   ")).toBe("First note");
    expect(appendTranscript(null, "")).toBe("");
  });
});

describe("voiceNoteFileName", () => {
  it("names the file from local wall-clock time, with a .wav extension", () => {
    // Constructed from parts, not a UTC string: the stamp is meant to read as
    // the moment the user recorded it, wherever they were.
    const at = new Date(2026, 7, 8, 9, 4, 3);
    expect(voiceNoteFileName(at)).toBe("voice-note-2026-08-08-090403.wav");
  });

  it("round-trips through the recogniser", () => {
    expect(isVoiceNoteFileName(voiceNoteFileName(new Date()))).toBe(true);
    expect(isVoiceNoteFileName("holiday-photo.jpg")).toBe(false);
  });
});

describe("formatRecordingTime", () => {
  it("counts in m:ss with a zero-padded seconds field", () => {
    expect(formatRecordingTime(0)).toBe("0:00");
    expect(formatRecordingTime(9_000)).toBe("0:09");
    expect(formatRecordingTime(75_000)).toBe("1:15");
    expect(formatRecordingTime(600_000)).toBe("10:00");
  });

  it("never shows a negative clock", () => {
    expect(formatRecordingTime(-1_000)).toBe("0:00");
  });
});
