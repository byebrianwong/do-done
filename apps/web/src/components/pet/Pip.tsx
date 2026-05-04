import type { AppearanceSeed, PetMood } from "@do-done/shared";

// ── Procedural SVG renderer for Pip ─────────────────────
//
// Pure presentational component. Given an AppearanceSeed (derived from a
// user's task corpus) and a PetMood (derived from current stats), renders a
// soft pastel-styled creature in SVG. No hooks, no side effects, no client
// directive — safe to render in server components and Storybook alike.
//
// Aesthetic E (Apple Notes / Tweek): pastel saturation, soft drop shadow,
// rounded everything. Body color comes from seed.bodyHue at HSL(h, 55%, 75%)
// — saturated enough to read as a color but soft enough to feel friendly.

export interface PipProps {
  seed: AppearanceSeed;
  mood: PetMood;
  size?: number;
  /** When true, renders without the soft "halo" background (for inline use). */
  bare?: boolean;
  className?: string;
  /** Stable id suffix to disambiguate gradient/filter ids when multiple Pips render. */
  idSuffix?: string;
}

const VIEWBOX = 100;

export function Pip({
  seed,
  mood,
  size = 140,
  bare = false,
  className,
  idSuffix,
}: PipProps) {
  const sfx = idSuffix ?? Math.random().toString(36).slice(2, 8);
  const bodyFill = `hsl(${seed.bodyHue}, 55%, 75%)`;
  const bodyHighlight = `hsl(${seed.bodyHue}, 60%, 85%)`;
  const bodyShadow = `hsl(${seed.bodyHue}, 45%, 60%)`;
  const ink = "#1f2937";

  // Mood-specific color/saturation tweaks. We keep the same geometry and
  // overlay mood-specific eyes/mouth, but desaturate slightly for downer moods.
  const desaturated =
    mood === "hungry" || mood === "sad" || mood === "tired";
  const moodFilter = desaturated ? "saturate(70%)" : undefined;

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

      <g style={{ filter: moodFilter }}>
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
        />
        <SleepingZ mood={mood} ink={ink} />
      </g>
    </svg>
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
  // Tired/sleeping pets sit a few px lower (sleepy slump).
  const yShift = mood === "sleeping" ? 4 : mood === "tired" ? 2 : 0;
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
      // Tall narrow drop with wavy bottom.
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
      // Blob with a single leaf on top.
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
      // Blob with three little hair tufts on top.
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
  // A small highlight blob to suggest dimensionality.
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

// ── Cheeks (only visible for happy/content) ────────────

function Cheeks({ mood }: { mood: PetMood }) {
  if (mood !== "happy" && mood !== "content") return null;
  const opacity = mood === "happy" ? 0.7 : 0.4;
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
}: {
  mood: PetMood;
  eyeStyle: AppearanceSeed["eyeStyle"];
  ink: string;
  highlight: string;
}) {
  return (
    <>
      <Eyes mood={mood} eyeStyle={eyeStyle} ink={ink} highlight={highlight} />
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
  // Mood overrides eyeStyle for sleeping, tired, hungry.
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
    // Droopy eyes — short downward-slanted lines on the outer edges.
    return (
      <>
        <line
          x1={EYE_LEFT_X - 5}
          y1={EYE_Y - 1}
          x2={EYE_LEFT_X + 5}
          y2={EYE_Y + 2}
          stroke={ink}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        <line
          x1={EYE_RIGHT_X - 5}
          y1={EYE_Y + 2}
          x2={EYE_RIGHT_X + 5}
          y2={EYE_Y - 1}
          stroke={ink}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </>
    );
  }

  // Happy/content/sad use the seed eye style at full size for happy/content,
  // slightly smaller for sad.
  const r = mood === "sad" ? 2.4 : 3.2;

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
          {/* Tiny stars to the side */}
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
      // Half-closed eyes: an arc + lash.
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
      return (
        <path
          d="M 43 67 Q 50 63 57 67"
          stroke={ink}
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
        />
      );
    case "sad":
      return (
        <path
          d="M 44 67 Q 50 63 56 67"
          stroke={ink}
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
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

// ── Mood-tinted halo backgrounds (aesthetic E pastels) ──

function haloFromMood(mood: PetMood): string {
  switch (mood) {
    case "happy":
      return "#fff5dd"; // cream
    case "content":
      return "#fff5dd";
    case "hungry":
      return "#fde0e9"; // soft pink
    case "tired":
      return "#e9dcf6"; // soft purple
    case "sad":
      return "#e0e7f4"; // muted blue
    case "sleeping":
      return "#dfe7d8"; // soft moss
  }
}
