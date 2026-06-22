"use client";

// Slim tab that brings the Pip panel back after it's been hidden.
//
// Purely presentational: positioning (fixed to the right edge, vertically
// centered) and the xl-only responsive gate live on the wrapper in AppShell,
// matching how PetPanelContainer is mounted. That keeps this component easy to
// render straight in a story.

const ROUNDED_SANS =
  'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif';

export function PetRevealTab({ onShow }: { onShow: () => void }) {
  return (
    <button
      type="button"
      onClick={onShow}
      aria-label="Show Pip"
      title="Show Pip (P)"
      className="flex flex-col items-center gap-1 rounded-l-2xl border border-r-0 px-2 py-3 shadow-md transition-[filter] hover:brightness-95"
      style={{
        backgroundColor: "#fffbe6",
        borderColor: "#ead7a8",
        color: "#8a7860",
        cursor: "pointer",
      }}
    >
      <span aria-hidden className="text-base">
        🐾
      </span>
      <span
        className="text-[10px] font-bold tracking-wide"
        style={{ writingMode: "vertical-rl", fontFamily: ROUNDED_SANS }}
      >
        Pip
      </span>
    </button>
  );
}
