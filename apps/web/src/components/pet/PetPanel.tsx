"use client";

import type {
  AppearanceSeed,
  PetEvent,
  PetGoal,
  PetMood,
} from "@do-done/shared";
import type { PetState } from "@do-done/api-client";
import { Pip } from "./Pip";

// ── PetPanel ───────────────────────────────────────────
//
// Right-side panel UI. Receives a fully-derived PetState (decay + mood
// already computed by PetsApi.getState) — this component does no fetching
// and no decay math. Purely presentational + invokes callbacks for goal
// actions.
//
// Aesthetic E (Apple Notes / Tweek soft):
//   - Yellow legal-pad cream background (#fffbe6)
//   - Rounded corners everywhere (rounded-2xl / 16-24px)
//   - Pastel stat bars: peach hunger, mint happiness, lavender energy
//   - Pastel pink goal card
//   - Activity log entries as soft cream/purple cards with emoji actor badges
//   - Rounded sans typography via `ui-rounded` system font (SF Pro Rounded
//     on Apple, falls through to system on others)

export interface PetPanelProps {
  state: PetState;
  onAcceptGoal?: (goalId: string) => void;
  onDismissGoal?: (goalId: string) => void;
  className?: string;
}

const ROUNDED_SANS =
  'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif';

export function PetPanel({
  state,
  onAcceptGoal,
  onDismissGoal,
  className,
}: PetPanelProps) {
  const { pet, current_stats, mood, goals, recent_events } = state;
  const seed = normalizeSeed(pet.appearance_seed);
  const activeGoal = goals.find((g) => g.status === "open") ?? null;

  return (
    <aside
      className={
        "flex h-full flex-col gap-5 p-5 " + (className ?? "")
      }
      style={{
        backgroundColor: "#fffbe6",
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(120,100,40,0.06) 1px, transparent 0)",
        backgroundSize: "20px 20px",
        fontFamily: ROUNDED_SANS,
        color: "#4a3f1f",
        width: 320,
      }}
    >
      <Header name={pet.name} level={pet.level} mood={mood} />
      <PipStage seed={seed} mood={mood} />
      <Stats stats={current_stats} />
      {activeGoal ? (
        <GoalCard
          goal={activeGoal}
          onAccept={() => onAcceptGoal?.(activeGoal.id)}
          onDismiss={() => onDismissGoal?.(activeGoal.id)}
        />
      ) : null}
      <RecentLog events={recent_events} />
    </aside>
  );
}

// ── Header ──────────────────────────────────────────────

function Header({
  name,
  level,
  mood,
}: {
  name: string;
  level: number;
  mood: PetMood;
}) {
  return (
    <div className="flex items-center gap-2">
      <h2
        className="m-0 text-[22px] font-extrabold tracking-tight"
        style={{ fontFamily: ROUNDED_SANS, color: "#4a3f1f" }}
      >
        {name}
      </h2>
      <span aria-hidden className="text-lg">
        {moodEmoji(mood)}
      </span>
      <span
        className="ml-auto rounded-full px-3 py-1 text-[11px] font-bold"
        style={{ backgroundColor: "#b6e3c7", color: "#2d6e44" }}
      >
        lvl {level}
      </span>
    </div>
  );
}

function moodEmoji(mood: PetMood): string {
  switch (mood) {
    case "happy":
      return "👋";
    case "content":
      return "🌼";
    case "hungry":
      return "🍎";
    case "tired":
      return "🥱";
    case "sad":
      return "💧";
    case "sleeping":
      return "💤";
  }
}

// ── Pip stage ───────────────────────────────────────────

function PipStage({ seed, mood }: { seed: AppearanceSeed; mood: PetMood }) {
  return (
    <div className="flex items-center justify-center py-2">
      <div
        className="rounded-full p-3"
        style={{
          backgroundColor: "#fff5dd",
          boxShadow: "0 6px 20px rgba(180,160,80,0.18)",
        }}
      >
        <Pip seed={seed} mood={mood} size={140} bare idSuffix="panel-main" />
      </div>
    </div>
  );
}

// ── Stats ───────────────────────────────────────────────

function Stats({
  stats,
}: {
  stats: PetState["current_stats"];
}) {
  return (
    <div className="flex flex-col gap-3">
      <StatRow
        emoji="🍎"
        label="Hunger"
        value={stats.hunger}
        fill="#fbb88a"
      />
      <StatRow
        emoji="🌸"
        label="Happiness"
        value={stats.happiness}
        fill="#9bd9b1"
      />
      <StatRow
        emoji="⚡"
        label="Energy"
        value={stats.energy}
        fill="#c5b3e8"
      />
    </div>
  );
}

function StatRow({
  emoji,
  label,
  value,
  fill,
}: {
  emoji: string;
  label: string;
  value: number;
  fill: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span aria-hidden className="w-5 text-center">
        {emoji}
      </span>
      <span
        className="w-[80px] font-semibold"
        style={{ color: "#4a3f1f" }}
      >
        {label}
      </span>
      <div
        className="flex-1 overflow-hidden rounded-full"
        style={{ backgroundColor: "#f5edd6", height: 12 }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            backgroundColor: fill,
          }}
        />
      </div>
      <span
        className="w-7 text-right text-[12px] font-bold"
        style={{ color: "#8a7860" }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Goal card ───────────────────────────────────────────

function GoalCard({
  goal,
  onAccept,
  onDismiss,
}: {
  goal: PetGoal;
  onAccept?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        backgroundColor: "#fde0e9",
        boxShadow: "0 2px 10px rgba(200,100,150,0.14)",
      }}
    >
      <p
        className="m-0 mb-3 text-[14px] font-bold leading-snug"
        style={{ color: "#5a3a4a", fontFamily: ROUNDED_SANS }}
      >
        {goal.description} ✨
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAccept}
          className="rounded-full px-4 py-2 text-[12px] font-bold transition-colors hover:brightness-105"
          style={{
            backgroundColor: "#f87171",
            color: "#ffffff",
            border: "none",
            cursor: "pointer",
            fontFamily: ROUNDED_SANS,
          }}
        >
          Add a task
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-rose-100"
          style={{
            backgroundColor: "transparent",
            color: "#a16080",
            border: "none",
            cursor: "pointer",
            fontFamily: ROUNDED_SANS,
          }}
        >
          Maybe later
        </button>
      </div>
      {goal.proposed_by !== "user" ? (
        <p
          className="m-0 mt-2 text-[10px] font-semibold"
          style={{ color: "#a16080", letterSpacing: "0.04em" }}
        >
          {goal.proposed_by === "claude"
            ? "✨ Suggested by Claude"
            : "🌼 From Pip"}
        </p>
      ) : null}
    </div>
  );
}

// ── Recent activity log ─────────────────────────────────

function RecentLog({ events }: { events: PetEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3
          className="m-0 text-[13px] font-extrabold"
          style={{ color: "#4a3f1f", fontFamily: ROUNDED_SANS }}
        >
          Recently
        </h3>
        <p
          className="m-0 rounded-2xl p-3 text-[12px]"
          style={{ backgroundColor: "#fff5dd", color: "#8a7860" }}
        >
          No events yet — finish a task to feed Pip 🌸
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto">
      <h3
        className="m-0 text-[13px] font-extrabold"
        style={{ color: "#4a3f1f", fontFamily: ROUNDED_SANS }}
      >
        Recently
      </h3>
      {events.slice(0, 5).map((ev) => (
        <EventCard key={ev.id} event={ev} />
      ))}
    </div>
  );
}

function EventCard({ event }: { event: PetEvent }) {
  const isClaude = event.actor === "claude";
  const bg = isClaude ? "#e9dcf6" : "#fff5dd";
  const fg = isClaude ? "#4a2f6e" : "#4a3f1f";
  const emoji = actorEmoji(event.actor);
  const summary = summarizeEvent(event);

  return (
    <div
      className="flex items-start gap-2 rounded-2xl p-3 text-[12px] leading-snug"
      style={{ backgroundColor: bg, color: fg }}
    >
      <span aria-hidden className="text-[14px]">
        {emoji}
      </span>
      <span className="flex-1">
        {summary}
        {event.narrative ? (
          <span style={{ color: fg, opacity: 0.75 }}>
            {" "}
            · {event.narrative}
          </span>
        ) : null}
      </span>
      <span
        className="text-[10px] font-semibold opacity-70"
        style={{ whiteSpace: "nowrap" }}
      >
        {timeAgo(event.created_at)}
      </span>
    </div>
  );
}

function actorEmoji(actor: PetEvent["actor"]): string {
  switch (actor) {
    case "user":
      return "🙋";
    case "claude":
      return "✨";
    case "system":
      return "🌱";
  }
}

function summarizeEvent(ev: PetEvent): string {
  if (ev.event_type === "fed") {
    const deltas: string[] = [];
    if (ev.delta_hunger > 0) deltas.push(`+${ev.delta_hunger} hunger`);
    if (ev.delta_happiness !== 0)
      deltas.push(
        `${ev.delta_happiness > 0 ? "+" : ""}${ev.delta_happiness} happy`
      );
    if (ev.delta_energy > 0) deltas.push(`+${ev.delta_energy} energy`);
    const actorWord =
      ev.actor === "claude"
        ? "Claude finished"
        : ev.actor === "system"
          ? "System recorded"
          : "You finished";
    return `${actorWord} a task · ${deltas.join(" · ") || "+xp"}`;
  }
  if (ev.event_type === "goal_proposed") {
    return ev.actor === "claude"
      ? "Claude proposed a goal"
      : "A goal was proposed";
  }
  if (ev.event_type === "goal_accepted") {
    return "You accepted a goal";
  }
  if (ev.event_type === "goal_completed") {
    return "Goal completed";
  }
  if (ev.event_type === "evolved") {
    return "Pip evolved!";
  }
  if (ev.event_type === "narrated") {
    return ev.narrative ?? "Pip noted something";
  }
  return ev.narrative ?? "Pip event";
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const now = Date.now();
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

// ── AppearanceSeed normalization ───────────────────────
//
// The DB column is JSONB and may be `{}` before regenerateAppearanceSeed has
// run. Fall back to sensible defaults so Pip always renders.

function normalizeSeed(raw: Record<string, unknown>): AppearanceSeed {
  const bodyHue =
    typeof raw.bodyHue === "number" && raw.bodyHue >= 0 && raw.bodyHue <= 360
      ? raw.bodyHue
      : 168; // teal-green default fits aesthetic E

  const validShapes = [
    "blob",
    "sprout",
    "orb",
    "tuft",
    "wisp",
    "pebble",
  ] as const;
  const bodyShape = validShapes.includes(raw.bodyShape as (typeof validShapes)[number])
    ? (raw.bodyShape as AppearanceSeed["bodyShape"])
    : "blob";

  const validEyes = ["dot", "sparkle", "sleepy", "wide"] as const;
  const eyeStyle = validEyes.includes(raw.eyeStyle as (typeof validEyes)[number])
    ? (raw.eyeStyle as AppearanceSeed["eyeStyle"])
    : "dot";

  const accessories = Array.isArray(raw.accessories)
    ? (raw.accessories as unknown[]).filter(
        (s): s is string => typeof s === "string"
      )
    : [];

  return { bodyHue, bodyShape, eyeStyle, accessories };
}
