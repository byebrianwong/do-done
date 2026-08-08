import { describe, expect, it } from "vitest";
import { isVoiceLaunch } from "./quick-add-launch";

describe("isVoiceLaunch", () => {
  it("recognises the Voice task shortcut", () => {
    expect(isVoiceLaunch("dodoneadd://voice")).toBe(true);
    expect(isVoiceLaunch("dodoneadd://voice/")).toBe(true);
    expect(isVoiceLaunch("dodoneadd://voice?from=shortcut")).toBe(true);
  });

  it("leaves the widget and Add task shortcut on the keyboard", () => {
    expect(isVoiceLaunch("dodoneadd://open")).toBe(false);
  });

  it("is false when the activity was launched with no URI at all", () => {
    expect(isVoiceLaunch(null)).toBe(false);
    expect(isVoiceLaunch(undefined)).toBe(false);
    expect(isVoiceLaunch("")).toBe(false);
  });

  it("does not match a host that merely starts with the same letters", () => {
    expect(isVoiceLaunch("dodoneadd://voicemail")).toBe(false);
  });

  it("does not match the main app's scheme", () => {
    // MainActivity owns `dodone://`; this activity must not claim its links.
    expect(isVoiceLaunch("dodone://voice")).toBe(false);
  });
});
