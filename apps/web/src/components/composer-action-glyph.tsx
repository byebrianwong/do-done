"use client";

function PlusIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" />
    </svg>
  );
}

function ReturnIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 5v6a3 3 0 0 1-3 3H5m0 0 4-4m-4 4 4 4"
      />
    </svg>
  );
}

/**
 * The one control in a composer that says what happens next.
 *
 * At rest it is a plus at the leading edge, and clicking it focuses the field.
 * While the field is live it slides to the trailing edge and turns into a
 * return key: grey until there is something to commit, coloured and clickable
 * once there is.
 *
 * It replaced a bare `+` glyph that did nothing. Every other plus in DoDone is
 * a button — the add button, New list, New project — so an inert one is a
 * promise the app does not keep. The fix is to make the symbol always name the
 * next action rather than to delete it, which is also how the composer teaches
 * that Enter commits and the field stays open for the next item.
 *
 * The caller owns the layout around it. The glyph is absolutely positioned
 * inside the field's own `relative` box, so the field has to reserve the
 * leading and trailing gutters it slides between.
 */
export function ComposerActionGlyph({
  active,
  armed,
  onSubmit,
  onFocusField,
  idleLabel,
  submitLabel,
}: {
  /** The field is focused or already holds text, so the glyph sits right. */
  active: boolean;
  /** There is something to commit, so the return key is live. */
  armed: boolean;
  onSubmit: () => void;
  onFocusField: () => void;
  /** What the plus does, for a screen reader. */
  idleLabel: string;
  /** What the return key does, for a screen reader. */
  submitLabel: string;
}) {
  return (
    <button
      type="button"
      // A press must not blur the field first. Without this the blur fires
      // before the click, `active` flips back, and the glyph slides home from
      // under the pointer instead of committing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (active && armed) onSubmit();
        onFocusField();
      }}
      aria-label={active && armed ? submitLabel : idleLabel}
      style={{ left: active ? "calc(100% - 2rem)" : "0.75rem" }}
      className={`dd-composer-glyph absolute top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center ${
        active && !armed
          ? // The same grey as the placeholder beside it, so the two read as
            // one empty state. Dimmer than this and the control disappears at
            // the moment a first-time user is looking for it; brighter and it
            // stops being obvious that pressing return would do nothing.
            "text-neutral-400 dark:text-neutral-500"
          : "text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400"
      }`}
    >
      {/*
        Both glyphs are drawn and crossfaded, so the swap happens partway
        through the slide rather than on the frame it starts. Swapping at the
        start reads as two symbols rather than one that moved.
      */}
      <span
        className={`absolute transition-opacity duration-150 ${
          active ? "opacity-0" : "opacity-100 delay-100"
        }`}
      >
        <PlusIcon />
      </span>
      <span
        className={`absolute transition-opacity duration-150 ${
          active ? "opacity-100 delay-100" : "opacity-0"
        }`}
      >
        <ReturnIcon />
      </span>
    </button>
  );
}
