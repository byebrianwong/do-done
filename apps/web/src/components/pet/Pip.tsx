import type { AppearanceSeed, PetMood } from "@do-done/shared";

// ── Procedural SVG renderer for Pip ─────────────────────
//
// Pure presentational component. Given an AppearanceSeed (derived from a
// user's task corpus) and a PetMood (derived from current stats), renders a
// soft pastel-styled creature in SVG. No hooks, no side effects, no client
// directive — safe to render in server components and Storybook alike.
//
// Pip is intentionally positive — there is no `sad` mood. Instead, when stats
// are healthy, the renderer cycles through expression variants: happy,
// content, curious, playful, cozy, thoughtful. Stat thresholds still surface
// gentle "needs care" cues (hungry, tired) and overnight idleness shows
// sleeping. Subtle CSS animations (blink, breathe, occasional head tilt) make
// the face feel alive even within a single expression.

export interface PipProps {
  seed: AppearanceSeed;
  mood: PetMood;
  size?: number;
  /** When true, renders without the soft "halo" background (for inline use). */
  bare?: boolean;
  className?: string;
  /** Stable id suffix to disambiguate gradient/filter ids when multiple Pips render. */
  idSuffix?: string;
  /**
   * Disable the breathing/blink/head-tilt CSS animations. Useful in
   * Chromatic snapshots so visual diffs aren't noise from animation frame
   * timing.
   */
  animate?: boolean;
}

const VIEWBOX = 100;

// Deterministic, SSR-safe id suffix for Pip's gradient/filter defs so multiple
// Pips on one page don't collide on their element ids. Derived from the
// appearance-determining inputs rather than Math.random() (which produced a
// different value on the server vs. the client — a hydration mismatch — and
// re-randomized on every render): two identical-looking Pips share ids
// harmlessly (their defs are identical), while distinct ones get distinct ids.
// Kept a plain pure function so Pip stays hook-free and server-renderable.
function suffixFromSeed(seed: AppearanceSeed, mood: PetMood): string {
  const raw = `${seed.bodyHue}-${seed.bodyShape}-${seed.eyeStyle}-${mood}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function Pip({
  seed,
  mood,
  size = 140,
  bare = false,
  className,
  idSuffix,
  animate = true,
}: PipProps) {
  const sfx = idSuffix ?? suffixFromSeed(seed, mood);
  const bodyFill = `hsl(${seed.bodyHue}, 55%, 75%)`;
  const bodyHighlight = `hsl(${seed.bodyHue}, 60%, 85%)`;
  const bodyShadow = `hsl(${seed.bodyHue}, 45%, 60%)`;
  const ink = "#1f2937";

  // Soft saturation pullback for the two "needs care" cues. The positive
  // variants render at full saturation.
  const desaturated = mood === "hungry" || mood === "tired";
  const moodFilter = desaturated ? "saturate(80%)" : undefined;

  const animClass = animate ? "pip-anim" : undefined;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className={className}
      role="img"
      aria-label={`Pip the pet, ${mood}`}
      style={{ overflow: "visible" }}
    >
      <defs>
        <radialGradient
          id={`pip-grad-${sfx}`}
          cx="40%"
          cy="35%"
          r="65%"
        >
          <stop offset="0%" stopColor={bodyHighlight} />
          <stop offset="70%" stopColor={bodyFill} />
          <stop offset="100%" stopColor={bodyShadow} />
        </radialGradient>
        <filter
          id={`pip-shadow-${sfx}`}
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
        {animate ? <PipAnimationStyle /> : null}
      </defs>

      {/* Soft halo background (skipped when bare) */}
      {!bare ? (
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={48}
          fill={haloFromMood(mood)}
          opacity={0.6}
        />
      ) : null}

      {/* Ground shadow */}
      <ellipse
        cx={50}
        cy={mood === "sleeping" ? 86 : 90}
        rx={mood === "sleeping" ? 30 : 24}
        ry={2.5}
        fill="rgba(60,40,20,0.18)"
      />

      <g
        className={animClass}
        style={{
          filter: moodFilter,
          transformOrigin: "50px 70px",
          transformBox: "fill-box",
        }}
      >
        <BodyShape
          shape={seed.bodyShape}
          mood={mood}
          gradientId={`pip-grad-${sfx}`}
          bodyShadow={bodyShadow}
        />
        <ShapeAccents
          shape={seed.bodyShape}
          highlight={bodyHighlight}
          ink={ink}
        />
        <Cheeks mood={mood} />
        <Face
          mood={mood}
          eyeStyle={seed.eyeStyle}
          ink={ink}
          highlight="#ffffff"
          animate={animate}
        />
        <SleepingZ mood={mood} ink={ink} />
        {mood === "curious" ? <CuriousQuestionMark ink={ink} /> : null}
        {mood === "playful" ? <PlayfulSparks /> : null}
        {mood === "cozy" ? <CozyBlanket bodyShadow={bodyShadow} /> : null}
        {mood === "thoughtful" ? <ThoughtBubble ink={ink} /> : null}
      </g>
    </svg>
  );
}

// ── Animations ─────────────────────────────────────────
//
// Subtle breathing on the body group, slow blink overlay across the eyes,
// occasional head-tilt rotation. All CSS keyframes scoped to `.pip-anim`
// so they only apply when `animate` is true.

function PipAnimationStyle() {
  return (
    <style>{`
      @keyframes pip-breathe {
        0%, 100% { transform: scale(1) translateY(0); }
        50% { transform: scale(1.015) translateY(-0.5px); }
      }
      @keyframes pip-tilt {
        0%, 60%, 100% { transform: rotate(0deg); }
        70% { transform: rotate(-2.5deg); }
        85% { transform: rotate(1.5deg); }
      }
      @keyframes pip-blink {
        0%, 92%, 100% { transform: scaleY(1); }
        94%, 97% { transform: scaleY(0.1); }
      }
      .pip-anim {
        animation:
          pip-breathe 3.4s ease-in-out infinite,
          pip-tilt 11s ease-in-out infinite;
        transform-origin: 50px 70px;
      }
      .pip-eyes-anim {
        animation: pip-blink 6s ease-in-out infinite;
        transform-origin: 50px 53px;
        transform-box: fill-box;
      }
    `}</style>
  );
}

// ── Body shapes ────────────────────────────────────────

function BodyShape({
  shape,
  mood,
  gradientId,
  bodyShadow,
}: {
  shape: AppearanceSeed["bodyShape"];
  mood: PetMood;
  gradientId: string;
  bodyShadow: string;
}) {
  // Tired/sleeping pets sit a few px lower (sleepy slump). Playful pets perk
  // up slightly.
  const yShift =
    mood === "sleeping" ? 4 : mood === "tired" ? 2 : mood === "playful" ? -1 : 0;
  const fill = `url(#${gradientId})`;
  const stroke = bodyShadow;
  const sw = 0.6;

  switch (shape) {
    case "blob":
      return (
        <ellipse
          cx={50}
          cy={55 + yShift}
          rx={36}
          ry={34}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    case "orb":
      return (
        <circle
          cx={50}
          cy={55 + yShift}
          r={36}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    case "pebble":
      return (
        <rect
          x={14}
          y={22 + yShift}
          width={72}
          height={66}
          rx={28}
          ry={24}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    case "wisp":
      return (
        <path
          d={`M 50 ${20 + yShift}
              C 72 ${20 + yShift} 84 ${36 + yShift} 84 ${56 + yShift}
              C 84 ${78 + yShift} 70 ${88 + yShift} 60 ${85 + yShift}
              C 56 ${83 + yShift} 53 ${88 + yShift} 50 ${88 + yShift}
              C 47 ${88 + yShift} 44 ${83 + yShift} 40 ${85 + yShift}
              C 30 ${88 + yShift} 16 ${78 + yShift} 16 ${56 + yShift}
              C 16 ${36 + yShift} 28 ${20 + yShift} 50 ${20 + yShift} Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    case "sprout":
      return (
        <>
          <path
            d={`M 50 ${20 + yShift}
                C 56 ${10 + yShift} 64 ${10 + yShift} 62 ${20 + yShift}
                C 60 ${24 + yShift} 54 ${24 + yShift} 50 ${22 + yShift} Z`}
            fill="#7dd3a0"
            stroke="#3a8a5a"
            strokeWidth={sw}
          />
          <line
            x1={50}
            y1={22 + yShift}
            x2={50}
            y2={28 + yShift}
            stroke="#3a8a5a"
            strokeWidth={1}
          />
          <ellipse
            cx={50}
            cy={58 + yShift}
            rx={36}
            ry={32}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        </>
      );
    case "tuft":
      return (
        <>
          <ellipse
            cx={50}
            cy={55 + yShift}
            rx={36}
            ry={33}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
          <path
            d={`M 38 ${24 + yShift} Q 40 ${16 + yShift} 44 ${22 + yShift}`}
            stroke={stroke}
            strokeWidth={1.5}
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={`M 48 ${22 + yShift} Q 50 ${14 + yShift} 54 ${22 + yShift}`}
            stroke={stroke}
            strokeWidth={1.5}
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={`M 56 ${22 + yShift} Q 60 ${16 + yShift} 62 ${24 + yShift}`}
            stroke={stroke}
            strokeWidth={1.5}
            fill="none"
            strokeLinecap="round"
          />
        </>
      );
  }
}

function ShapeAccents({
  shape,
  highlight,
  ink: _ink,
}: {
  shape: AppearanceSeed["bodyShape"];
  highlight: string;
  ink: string;
}) {
  if (shape === "wisp") return null;
  return (
    <ellipse
      cx={42}
      cy={44}
      rx={9}
      ry={5}
      fill={highlight}
      opacity={0.55}
    />
  );
}

// ── Cheeks ─────────────────────────────────────────────

function Cheeks({ mood }: { mood: PetMood }) {
  // Cheek blush is part of the positive expression vocabulary. Stronger on
  // happy/playful, lighter on the others. Skipped entirely for sleeping +
  // care cues.
  const opacity =
    mood === "happy" || mood === "playful"
      ? 0.7
      : mood === "content" || mood === "cozy" || mood === "curious"
        ? 0.45
        : mood === "thoughtful"
          ? 0.3
          : 0;
  if (opacity === 0) return null;
  return (
    <>
      <ellipse
        cx={32}
        cy={62}
        rx={4}
        ry={2.5}
        fill="#ffb6c1"
        opacity={opacity}
      />
      <ellipse
        cx={68}
        cy={62}
        rx={4}
        ry={2.5}
        fill="#ffb6c1"
        opacity={opacity}
      />
    </>
  );
}

// ── Face (eyes + mouth, mood-driven) ───────────────────

function Face({
  mood,
  eyeStyle,
  ink,
  highlight,
  animate,
}: {
  mood: PetMood;
  eyeStyle: AppearanceSeed["eyeStyle"];
  ink: string;
  highlight: string;
  animate: boolean;
}) {
  return (
    <>
      <g className={animate && mood !== "sleeping" ? "pip-eyes-anim" : undefined}>
        <Eyes mood={mood} eyeStyle={eyeStyle} ink={ink} highlight={highlight} />
      </g>
      <Mouth mood={mood} ink={ink} />
    </>
  );
}

const EYE_LEFT_X = 40;
const EYE_RIGHT_X = 60;
const EYE_Y = 53;

function Eyes({
  mood,
  eyeStyle,
  ink,
  highlight,
}: {
  mood: PetMood;
  eyeStyle: AppearanceSeed["eyeStyle"];
  ink: string;
  highlight: string;
}) {
  if (mood === "sleeping") {
    return (
      <>
        <path
          d={`M ${EYE_LEFT_X - 5} ${EYE_Y + 1} Q ${EYE_LEFT_X} ${EYE_Y + 4} ${EYE_LEFT_X + 5} ${EYE_Y + 1}`}
          stroke={ink}
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M ${EYE_RIGHT_X - 5} ${EYE_Y + 1} Q ${EYE_RIGHT_X} ${EYE_Y + 4} ${EYE_RIGHT_X + 5} ${EYE_Y + 1}`}
          stroke={ink}
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
        />
      </>
    );
  }
  if (mood === "tired") {
    return (
      <>
        <line
          x1={EYE_LEFT_X - 5}
          y1={EYE_Y + 1}
          x2={EYE_LEFT_X + 5}
          y2={EYE_Y + 1}
          stroke={ink}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        <line
          x1={EYE_RIGHT_X - 5}
          y1={EYE_Y + 1}
          x2={EYE_RIGHT_X + 5}
          y2={EYE_Y + 1}
          stroke={ink}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </>
    );
  }
  if (mood === "hungry") {
    // Soft round eyes looking up — still cute, not droopy. Removes the
    // downer-X look from the prior version.
    return (
      <>
        <circle cx={EYE_LEFT_X} cy={EYE_Y} r={2.8} fill={ink} />
        <circle cx={EYE_RIGHT_X} cy={EYE_Y} r={2.8} fill={ink} />
        <circle
          cx={EYE_LEFT_X + 0.5}
          cy={EYE_Y - 1.2}
          r={0.9}
          fill={highlight}
        />
        <circle
          cx={EYE_RIGHT_X + 0.5}
          cy={EYE_Y - 1.2}
          r={0.9}
          fill={highlight}
        />
      </>
    );
  }
  if (mood === "curious") {
    // One eye slightly bigger than the other (asymmetric "tilted head" feel).
    return (
      <>
        <circle cx={EYE_LEFT_X} cy={EYE_Y} r={3.4} fill={ink} />
        <circle cx={EYE_RIGHT_X} cy={EYE_Y - 0.6} r={3.8} fill={ink} />
        <circle
          cx={EYE_LEFT_X + 1}
          cy={EYE_Y - 1}
          r={1.1}
          fill={highlight}
        />
        <circle
          cx={EYE_RIGHT_X + 1.2}
          cy={EYE_Y - 1.6}
          r={1.3}
          fill={highlight}
        />
      </>
    );
  }
  if (mood === "playful") {
    // ^^ closed-curve "joyful squint" eyes.
    return (
      <>
        <path
          d={`M ${EYE_LEFT_X - 4} ${EYE_Y + 1} Q ${EYE_LEFT_X} ${EYE_Y - 3} ${EYE_LEFT_X + 4} ${EYE_Y + 1}`}
          stroke={ink}
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M ${EYE_RIGHT_X - 4} ${EYE_Y + 1} Q ${EYE_RIGHT_X} ${EYE_Y - 3} ${EYE_RIGHT_X + 4} ${EYE_Y + 1}`}
          stroke={ink}
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
        />
      </>
    );
  }
  if (mood === "cozy") {
    // Soft half-moon eyes — content with a sleepy edge.
    return (
      <>
        <path
          d={`M ${EYE_LEFT_X - 3} ${EYE_Y} A 3 3 0 0 1 ${EYE_LEFT_X + 3} ${EYE_Y}`}
          fill={ink}
        />
        <path
          d={`M ${EYE_RIGHT_X - 3} ${EYE_Y} A 3 3 0 0 1 ${EYE_RIGHT_X + 3} ${EYE_Y}`}
          fill={ink}
        />
      </>
    );
  }
  if (mood === "thoughtful") {
    // Eyes glancing up-right.
    return (
      <>
        <circle cx={EYE_LEFT_X + 0.8} cy={EYE_Y - 0.6} r={2.6} fill={ink} />
        <circle cx={EYE_RIGHT_X + 0.8} cy={EYE_Y - 0.6} r={2.6} fill={ink} />
      </>
    );
  }

  // happy / content: use seed eye style.
  const r = 3.2;
  switch (eyeStyle) {
    case "dot":
      return (
        <>
          <circle cx={EYE_LEFT_X} cy={EYE_Y} r={r} fill={ink} />
          <circle cx={EYE_RIGHT_X} cy={EYE_Y} r={r} fill={ink} />
        </>
      );
    case "sparkle":
      return (
        <>
          <circle cx={EYE_LEFT_X} cy={EYE_Y} r={r} fill={ink} />
          <circle cx={EYE_RIGHT_X} cy={EYE_Y} r={r} fill={ink} />
          <circle
            cx={EYE_LEFT_X + 1}
            cy={EYE_Y - 1}
            r={1}
            fill={highlight}
          />
          <circle
            cx={EYE_RIGHT_X + 1}
            cy={EYE_Y - 1}
            r={1}
            fill={highlight}
          />
          <text
            x={EYE_LEFT_X - 9}
            y={EYE_Y - 4}
            fontSize={5}
            fill={ink}
            opacity={0.5}
          >
            ✦
          </text>
        </>
      );
    case "sleepy":
      return (
        <>
          <path
            d={`M ${EYE_LEFT_X - r} ${EYE_Y} A ${r} ${r} 0 0 1 ${EYE_LEFT_X + r} ${EYE_Y}`}
            fill={ink}
          />
          <path
            d={`M ${EYE_RIGHT_X - r} ${EYE_Y} A ${r} ${r} 0 0 1 ${EYE_RIGHT_X + r} ${EYE_Y}`}
            fill={ink}
          />
        </>
      );
    case "wide":
      return (
        <>
          <circle cx={EYE_LEFT_X} cy={EYE_Y} r={r + 0.8} fill={ink} />
          <circle cx={EYE_RIGHT_X} cy={EYE_Y} r={r + 0.8} fill={ink} />
          <circle
            cx={EYE_LEFT_X + 1.4}
            cy={EYE_Y - 1.2}
            r={1.4}
            fill={highlight}
          />
          <circle
            cx={EYE_RIGHT_X + 1.4}
            cy={EYE_Y - 1.2}
            r={1.4}
            fill={highlight}
          />
        </>
      );
  }
}

function Mouth({ mood, ink }: { mood: PetMood; ink: string }) {
  switch (mood) {
    case "happy":
      return (
        <path
          d="M 41 64 Q 50 71 59 64"
          stroke={ink}
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
        />
      );
    case "content":
      return (
        <path
          d="M 44 64 Q 50 67 56 64"
          stroke={ink}
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
        />
      );
    case "curious":
      // Small "o" mouth.
      return (
        <ellipse
          cx={50}
          cy={66}
          rx={1.8}
          ry={2.2}
          fill={ink}
          opacity={0.85}
        />
      );
    case "playful":
      // Wide grin with little tongue dot.
      return (
        <>
          <path
            d="M 39 64 Q 50 73 61 64"
            stroke={ink}
            strokeWidth={1.8}
            fill="none"
            strokeLinecap="round"
          />
          <circle cx={50} cy={70} r={1.4} fill="#f97a8a" />
        </>
      );
    case "cozy":
      // Soft tilted smile.
      return (
        <path
          d="M 43 65 Q 50 68 56 64"
          stroke={ink}
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
        />
      );
    case "thoughtful":
      // Small line off-center, lips pursed.
      return (
        <line
          x1={47}
          y1={65}
          x2={53}
          y2={65}
          stroke={ink}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      );
    case "tired":
      return (
        <line
          x1={45}
          y1={65}
          x2={55}
          y2={65}
          stroke={ink}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      );
    case "hungry":
      // Small open oval mouth (waiting for food). Friendlier than the prior
      // downward-curving "hungry" line.
      return (
        <ellipse
          cx={50}
          cy={67}
          rx={2.2}
          ry={1.6}
          fill={ink}
          opacity={0.75}
        />
      );
    case "sleeping":
      return (
        <path
          d="M 46 65 Q 50 67 54 65"
          stroke={ink}
          strokeWidth={1.4}
          fill="none"
          strokeLinecap="round"
        />
      );
  }
}

function SleepingZ({ mood, ink }: { mood: PetMood; ink: string }) {
  if (mood !== "sleeping") return null;
  return (
    <text
      x={70}
      y={32}
      fontSize={10}
      fill={ink}
      opacity={0.6}
      style={{ fontFamily: "ui-rounded, system-ui, sans-serif" }}
    >
      z
      <tspan fontSize={7} dx={1} dy={-3}>
        z
      </tspan>
    </text>
  );
}

// ── Mood-specific accents ──────────────────────────────

function CuriousQuestionMark({ ink }: { ink: string }) {
  return (
    <text
      x={74}
      y={34}
      fontSize={12}
      fill={ink}
      opacity={0.55}
      style={{ fontFamily: "ui-rounded, system-ui, sans-serif", fontWeight: 700 }}
    >
      ?
    </text>
  );
}

function PlayfulSparks() {
  return (
    <>
      <text x={18} y={34} fontSize={9} fill="#f59e0b" opacity={0.7}>
        ✦
      </text>
      <text x={78} y={42} fontSize={7} fill="#f59e0b" opacity={0.6}>
        ✦
      </text>
      <text x={22} y={70} fontSize={6} fill="#f59e0b" opacity={0.5}>
        ✦
      </text>
    </>
  );
}

function CozyBlanket({ bodyShadow }: { bodyShadow: string }) {
  // A soft horizontal blanket band across the lower body.
  return (
    <path
      d="M 14 74 Q 50 82 86 74 L 86 84 Q 50 88 14 84 Z"
      fill={bodyShadow}
      opacity={0.32}
    />
  );
}

function ThoughtBubble({ ink }: { ink: string }) {
  // Two small clouds drifting up + right.
  return (
    <>
      <circle cx={76} cy={32} r={3.5} fill="#ffffff" stroke={ink} strokeWidth={0.6} opacity={0.85} />
      <circle cx={82} cy={26} r={2.5} fill="#ffffff" stroke={ink} strokeWidth={0.6} opacity={0.85} />
      <circle cx={85} cy={22} r={1.4} fill="#ffffff" stroke={ink} strokeWidth={0.6} opacity={0.85} />
    </>
  );
}

// ── Mood-tinted halo backgrounds ───────────────────────

function haloFromMood(mood: PetMood): string {
  switch (mood) {
    case "happy":
      return "#fff5dd"; // cream
    case "content":
      return "#fff5dd";
    case "curious":
      return "#dff4ff"; // soft sky
    case "playful":
      return "#fff0e0"; // peach
    case "cozy":
      return "#f4e8d8"; // soft taupe
    case "thoughtful":
      return "#ebe4f5"; // soft lavender
    case "hungry":
      return "#fde0e9"; // soft pink
    case "tired":
      return "#e9dcf6"; // soft purple
    case "sleeping":
      return "#dfe7d8"; // soft moss
  }
}
