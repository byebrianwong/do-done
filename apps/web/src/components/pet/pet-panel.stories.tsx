import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PetPanel } from "./PetPanel";
import {
  SAMPLE_PET_EVENTS,
  makePetEvent,
  makePetGoal,
  makePetState,
} from "../__stories__/mocks";

const meta: Meta<typeof PetPanel> = {
  title: "Pet/PetPanel",
  component: PetPanel,
  parameters: {
    layout: "padded",
    backgrounds: { default: "neutral" },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          display: "flex",
          height: 720,
          alignItems: "stretch",
          gap: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            padding: "24px",
            backgroundColor: "#f3f4f6",
            opacity: 0.55,
            borderRadius: "16px 0 0 16px",
            fontFamily: "Inter, system-ui, sans-serif",
            color: "#374151",
          }}
        >
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#9ca3af",
              margin: 0,
            }}
          >
            Today
          </p>
          <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0 }}>
            {[
              "Design system audit",
              "Migration plan review",
              "Email follow-ups",
              "Storybook stories for pet panel",
            ].map((t) => (
              <li
                key={t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 0",
                  borderBottom: "1px solid #e5e7eb",
                  fontSize: 14,
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    border: "1.5px solid #d1d5db",
                  }}
                />
                <span style={{ flex: 1 }}>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default (happy + healthy stats) ───────────────────

export const Default: Story = {
  args: {
    state: makePetState({
      mood: "happy",
      current_stats: { hunger: 75, happiness: 80, energy: 65 },
    }),
  },
};

// ── Mood states ───────────────────────────────────────

export const Hungry: Story = {
  args: {
    state: makePetState({
      mood: "hungry",
      current_stats: { hunger: 18, happiness: 60, energy: 55 },
    }),
  },
};

export const Tired: Story = {
  args: {
    state: makePetState({
      mood: "tired",
      current_stats: { hunger: 60, happiness: 55, energy: 18 },
    }),
  },
};

export const Sad: Story = {
  args: {
    state: makePetState({
      mood: "sad",
      current_stats: { hunger: 60, happiness: 22, energy: 50 },
    }),
  },
};

export const Sleeping: Story = {
  args: {
    state: makePetState({
      mood: "sleeping",
      current_stats: { hunger: 50, happiness: 70, energy: 60 },
    }),
  },
};

export const Content: Story = {
  args: {
    state: makePetState({
      mood: "content",
      current_stats: { hunger: 55, happiness: 60, energy: 50 },
    }),
  },
};

// ── With active goal ──────────────────────────────────

export const WithGoalFromClaude: Story = {
  args: {
    state: makePetState({
      mood: "happy",
      goals: [
        makePetGoal({
          description: "Pip wants to learn something new this week",
          proposed_by: "claude",
        }),
      ],
    }),
  },
};

export const WithGoalFromPet: Story = {
  args: {
    state: makePetState({
      mood: "content",
      goals: [
        makePetGoal({
          description: "Pip would love a walk outside",
          proposed_by: "pet",
        }),
      ],
    }),
  },
};

// ── Activity log variants ─────────────────────────────

export const ClaudeFedRecently: Story = {
  args: {
    state: makePetState({
      mood: "happy",
      recent_events: [
        makePetEvent({
          minutesAgo: 4,
          actor: "claude",
          event_type: "fed",
          delta_hunger: 15,
          delta_happiness: 10,
          delta_xp: 15,
          narrative: "Triaged inbox while you were in standup",
        }),
        makePetEvent({
          minutesAgo: 22,
          actor: "claude",
          event_type: "fed",
          delta_hunger: 8,
          delta_xp: 5,
          narrative: "Replied to two non-urgent emails",
        }),
        makePetEvent({
          minutesAgo: 80,
          actor: "user",
          event_type: "fed",
          delta_hunger: 20,
          delta_happiness: 15,
          delta_xp: 50,
          narrative: "Shipped the storybook PR",
        }),
      ],
    }),
  },
};

export const EmptyLog: Story = {
  args: {
    state: makePetState({
      mood: "content",
      recent_events: [],
    }),
  },
};

export const LongLog: Story = {
  args: {
    state: makePetState({
      mood: "happy",
      recent_events: [
        ...SAMPLE_PET_EVENTS,
        makePetEvent({
          minutesAgo: 360,
          actor: "user",
          event_type: "goal_completed",
          narrative: "Read one chapter of design book",
        }),
        makePetEvent({
          minutesAgo: 720,
          actor: "claude",
          event_type: "goal_proposed",
          narrative: "Pip wants to learn something new this week",
        }),
      ],
    }),
  },
};

// ── Body shape variants in panel context ──────────────

export const BodyShape_Sprout: Story = {
  args: {
    state: makePetState({
      mood: "happy",
      pet: {
        appearance_seed: { bodyHue: 12, bodyShape: "sprout", eyeStyle: "sparkle", accessories: [] },
      },
    }),
  },
};

export const BodyShape_Tuft: Story = {
  args: {
    state: makePetState({
      mood: "content",
      pet: {
        appearance_seed: { bodyHue: 280, bodyShape: "tuft", eyeStyle: "wide", accessories: [] },
      },
    }),
  },
};

export const BodyShape_Wisp: Story = {
  args: {
    state: makePetState({
      mood: "happy",
      pet: {
        appearance_seed: { bodyHue: 200, bodyShape: "wisp", eyeStyle: "sleepy", accessories: [] },
      },
    }),
  },
};

// ── Stat extremes ─────────────────────────────────────

export const StatsAllMaxed: Story = {
  args: {
    state: makePetState({
      mood: "happy",
      current_stats: { hunger: 100, happiness: 100, energy: 100 },
    }),
  },
};

export const StatsAllZero: Story = {
  args: {
    state: makePetState({
      mood: "hungry",
      current_stats: { hunger: 0, happiness: 0, energy: 0 },
    }),
  },
};
