/**
 * The failure this covers is a *sentence*, which is not something a device can
 * check for you: the screen showed "Up to date" on a build that was five
 * updates behind and physically unable to take any of them. Every branch here
 * exists because it once wore the wrong words.
 */
import { describe, it, expect } from "vitest";
import { describeNoUpdate } from "./update-check";

describe("describeNoUpdate", () => {
  it("only claims currency when the server really had nothing newer", () => {
    const { title, body } = describeNoUpdate("noUpdateAvailableOnServer", "preview");
    expect(title).toBe("Up to date");
    // Naming the channel is half the diagnosis: "up to date" on a channel
    // nothing publishes to is true and useless.
    expect(body).toContain("preview");
  });

  it("says a failed update needs a new install, not a retry", () => {
    const { title, body } = describeNoUpdate("updatePreviouslyFailed", "preview");
    expect(title).not.toBe("Up to date");
    expect(body).toMatch(/new install/);
  });

  it("does not call a rejected update current", () => {
    for (const reason of [
      "updateRejectedBySelectionPolicy",
      "rollbackRejectedBySelectionPolicy",
      "rollbackNoEmbeddedConfiguration",
    ]) {
      expect(describeNoUpdate(reason, "preview").title).not.toBe("Up to date");
    }
  });

  it("stays honest about a reason it doesn't recognise", () => {
    // An older expo-updates returns no reason at all; a newer one may add
    // reasons this file has never heard of. Neither is evidence of currency.
    expect(describeNoUpdate(undefined, "preview").title).not.toBe("Up to date");
    expect(describeNoUpdate("somethingNew", "preview").title).not.toBe("Up to date");
  });
});
