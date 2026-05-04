import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Pip } from "./Pip";
import { SAMPLE_APPEARANCE_SEED } from "../__stories__/mocks";

const meta: Meta<typeof Pip> = {
  title: "Pet/Pip",
  component: Pip,
  parameters: {
    backgrounds: { default: "light" },
    layout: "centered",
  },
  args: {
    seed: SAMPLE_APPEARANCE_SEED,
    mood: "happy",
    size: 180,
  },
  decorators: [
    (Story) => (
      <div
        className="rounded-3xl p-8"
        style={{ backgroundColor: "#fffbe6" }}
      >
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Mood gallery ───────────────────────────────────────

export const Happy: Story = { args: { mood: "happy" } };
export const Content: Story = { args: { mood: "content" } };
export const Hungry: Story = { args: { mood: "hungry" } };
export const Tired: Story = { args: { mood: "tired" } };
export const Sad: Story = { args: { mood: "sad" } };
export const Sleeping: Story = { args: { mood: "sleeping" } };

// ── Side-by-side mood gallery ─────────────────────────

export const AllMoods: Story = {
  render: () => (
    <div
      className="grid gap-6"
      style={{
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        backgroundColor: "transparent",
      }}
    >
      {(
        ["happy", "content", "hungry", "tired", "sad", "sleeping"] as const
      ).map((m) => (
        <div key={m} className="flex flex-col items-center gap-2">
          <Pip
            seed={SAMPLE_APPEARANCE_SEED}
            mood={m}
            size={140}
            idSuffix={m}
          />
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: "#8a7860" }}
          >
            {m}
          </span>
        </div>
      ))}
    </div>
  ),
};

// ── Body shape gallery (all happy) ────────────────────

export const AllBodyShapes: Story = {
  render: () => (
    <div
      className="grid gap-6"
      style={{
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      }}
    >
      {(
        ["blob", "sprout", "orb", "tuft", "wisp", "pebble"] as const
      ).map((shape) => (
        <div key={shape} className="flex flex-col items-center gap-2">
          <Pip
            seed={{ ...SAMPLE_APPEARANCE_SEED, bodyShape: shape }}
            mood="happy"
            size={140}
            idSuffix={`shape-${shape}`}
          />
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: "#8a7860" }}
          >
            {shape}
          </span>
        </div>
      ))}
    </div>
  ),
};

// ── Eye style gallery ─────────────────────────────────

export const AllEyeStyles: Story = {
  render: () => (
    <div
      className="grid gap-6"
      style={{
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      }}
    >
      {(["dot", "sparkle", "sleepy", "wide"] as const).map((eyes) => (
        <div key={eyes} className="flex flex-col items-center gap-2">
          <Pip
            seed={{ ...SAMPLE_APPEARANCE_SEED, eyeStyle: eyes }}
            mood="happy"
            size={140}
            idSuffix={`eyes-${eyes}`}
          />
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: "#8a7860" }}
          >
            {eyes}
          </span>
        </div>
      ))}
    </div>
  ),
};

// ── Hue diversity ─────────────────────────────────────

export const HueGallery: Story = {
  render: () => (
    <div
      className="grid gap-6"
      style={{
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      }}
    >
      {[
        { name: "Coral", hue: 12 },
        { name: "Amber", hue: 38 },
        { name: "Mint", hue: 168 },
        { name: "Sky", hue: 210 },
        { name: "Indigo", hue: 250 },
        { name: "Magenta", hue: 320 },
        { name: "Slate", hue: 220 },
        { name: "Lavender", hue: 280 },
      ].map(({ name, hue }) => (
        <div key={name} className="flex flex-col items-center gap-2">
          <Pip
            seed={{ ...SAMPLE_APPEARANCE_SEED, bodyHue: hue }}
            mood="happy"
            size={120}
            idSuffix={`hue-${hue}`}
          />
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: "#8a7860" }}
          >
            {name}
          </span>
        </div>
      ))}
    </div>
  ),
};

// ── Bare (no halo) for inline use ─────────────────────

export const Bare: Story = {
  args: { bare: true, size: 120 },
  parameters: {
    docs: {
      description: {
        story:
          "Without the soft halo background — used inline (e.g. inset 'when hungry' swatches).",
      },
    },
  },
};
