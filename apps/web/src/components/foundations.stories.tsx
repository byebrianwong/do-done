import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  DEFAULT_PROJECT_COLORS,
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  STATUS_ORDER,
} from "@do-done/shared";
import { colors, radius, shadows, spacing, typography } from "@do-done/ui";

/**
 * Foundations — the bottom layer of the design system.
 *
 * These stories render the raw tokens (color, type, spacing, radius, shadow)
 * and the shared semantic config (priority + status) straight from
 * `@do-done/ui` and `@do-done/shared`. They're the "atoms": when a token
 * changes, every component and page that consumes it shifts — so a visual diff
 * here is the earliest, broadest signal of blast radius.
 */
const meta: Meta = {
  title: "Foundations/Design Tokens",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-white p-8 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Small presentational helpers (story-local) ─────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-neutral-400">
      {children}
    </h2>
  );
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-14 w-full rounded-lg border border-black/5 shadow-sm dark:border-white/10"
        style={{ backgroundColor: value }}
      />
      <div>
        <div className="text-xs font-medium">{name}</div>
        <div className="font-mono text-[11px] uppercase text-neutral-500">
          {value}
        </div>
      </div>
    </div>
  );
}

function Scale({
  title,
  scale,
}: {
  title: string;
  scale: Record<string, string>;
}) {
  return (
    <section className="mb-10">
      <SectionTitle>{title}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {Object.entries(scale).map(([k, v]) => (
          <Swatch key={k} name={k} value={v} />
        ))}
      </div>
    </section>
  );
}

// ── Color ──────────────────────────────────────────────────────────────

export const Color: Story = {
  render: () => (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold">Color</h1>
      <p className="mb-8 text-sm text-neutral-500">
        Indigo-500 (#6366f1) is the accent. Neutral carries surfaces and text.
      </p>
      <Scale title="Primary (Indigo)" scale={colors.primary} />
      <Scale title="Neutral" scale={colors.neutral} />

      <section className="mb-10">
        <SectionTitle>Priority</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(PRIORITY_CONFIG).map(([k, cfg]) => (
            <Swatch key={k} name={`${k} · ${cfg.label}`} value={cfg.color} />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Status (semantic)</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(colors.status).map(([k, v]) => (
            <Swatch key={k} name={k} value={v} />
          ))}
        </div>
      </section>
    </div>
  ),
};

// ── Typography ─────────────────────────────────────────────────────────

export const Typography: Story = {
  render: () => (
    <div
      className="mx-auto max-w-3xl"
      style={{ fontFamily: typography.fontFamily.sans }}
    >
      <h1 className="mb-1 text-2xl font-semibold">Typography</h1>
      <p className="mb-8 text-sm text-neutral-500">
        Inter across the board. The scale below maps each token to its
        size / line-height.
      </p>
      <div className="space-y-6">
        {Object.entries(typography.fontSize).map(([name, t]) => (
          <div
            key={name}
            className="flex items-baseline gap-6 border-b border-neutral-100 pb-4 dark:border-neutral-800"
          >
            <div className="w-24 shrink-0 font-mono text-[11px] uppercase text-neutral-400">
              {name}
              <div className="text-neutral-500">
                {t.size}/{t.lineHeight}
              </div>
            </div>
            <div
              style={{ fontSize: t.size, lineHeight: `${t.lineHeight}px` }}
              className="text-neutral-900 dark:text-neutral-100"
            >
              The quick brown fox
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <SectionTitle>Weights</SectionTitle>
        <div className="space-y-2 text-lg">
          <p className="font-normal">Regular — body copy and descriptions</p>
          <p className="font-medium">Medium — task titles and labels</p>
          <p className="font-semibold">Semibold — page and section headings</p>
          <p className="font-bold">Bold — brand wordmark</p>
        </div>
      </div>

      <div className="mt-10">
        <SectionTitle>Mono</SectionTitle>
        <p
          style={{ fontFamily: typography.fontFamily.mono }}
          className="text-sm text-neutral-600 dark:text-neutral-400"
        >
          FREQ=WEEKLY;BYDAY=MO,TU · ⌘K · 09:30
        </p>
      </div>
    </div>
  ),
};

// ── Spacing ────────────────────────────────────────────────────────────

export const Spacing: Story = {
  render: () => (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">Spacing</h1>
      <p className="mb-8 text-sm text-neutral-500">
        4px base grid. Token → pixels.
      </p>
      <div className="space-y-3">
        {Object.entries(spacing).map(([name, px]) => (
          <div key={name} className="flex items-center gap-4">
            <div className="w-12 shrink-0 font-mono text-xs text-neutral-400">
              {name}
            </div>
            <div className="w-12 shrink-0 font-mono text-xs text-neutral-500">
              {px}px
            </div>
            <div
              className="h-4 rounded bg-indigo-500"
              style={{ width: Math.max(px, 1) }}
            />
          </div>
        ))}
      </div>
    </div>
  ),
};

// ── Radius & elevation ─────────────────────────────────────────────────

export const RadiusAndShadow: Story = {
  name: "Radius & Shadow",
  render: () => (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">Radius &amp; Shadow</h1>
      <p className="mb-8 text-sm text-neutral-500">
        Corner radii and the three elevation levels.
      </p>

      <section className="mb-10">
        <SectionTitle>Border radius</SectionTitle>
        <div className="flex flex-wrap gap-6">
          {Object.entries(radius).map(([name, r]) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <div
                className="h-16 w-16 border-2 border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
                style={{ borderRadius: Math.min(r, 32) }}
              />
              <div className="font-mono text-[11px] text-neutral-500">
                {name} · {r === 9999 ? "full" : `${r}px`}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Shadow</SectionTitle>
        <div className="flex flex-wrap gap-8 py-4">
          {Object.entries(shadows).map(([name, s]) => (
            <div key={name} className="flex flex-col items-center gap-3">
              <div
                className="h-20 w-28 rounded-xl bg-white dark:bg-neutral-900"
                style={{ boxShadow: s }}
              />
              <div className="font-mono text-[11px] text-neutral-500">
                {name}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
};

// ── Semantic config: priority + status badges ──────────────────────────

export const PriorityAndStatus: Story = {
  name: "Priority & Status",
  render: () => (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">Priority &amp; Status</h1>
      <p className="mb-8 text-sm text-neutral-500">
        Shared config from <code>@do-done/shared</code> — the same source the
        task row and editor read from.
      </p>

      <section className="mb-10">
        <SectionTitle>Priority</SectionTitle>
        <div className="flex flex-wrap gap-3">
          {(["p1", "p2", "p3", "p4"] as const).map((p) => {
            const cfg = PRIORITY_CONFIG[p];
            const litCount = { p1: 4, p2: 3, p3: 2, p4: 1 }[p];
            const heights = ["h-1", "h-1.5", "h-2", "h-2.5"];
            return (
              <div
                key={p}
                className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800"
              >
                <span className="inline-flex items-end gap-[2px]">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`block w-[3px] rounded-[1px] ${heights[i]} ${
                        i < litCount ? "" : "bg-neutral-200 dark:bg-neutral-700"
                      }`}
                      style={
                        i < litCount ? { backgroundColor: cfg.color } : undefined
                      }
                    />
                  ))}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ color: cfg.color, backgroundColor: `${cfg.color}1a` }}
                >
                  {cfg.label}
                </span>
                <span className="font-mono text-[11px] text-neutral-400">
                  {p}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-10">
        <SectionTitle>Status</SectionTitle>
        <div className="flex flex-wrap gap-3">
          {STATUS_ORDER.map((s) => {
            const cfg = STATUS_CONFIG[s];
            return (
              <div
                key={s}
                className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800"
              >
                <span
                  className="h-3.5 w-3.5 rounded-full border-2"
                  style={{ borderColor: cfg.color }}
                />
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: cfg.color, backgroundColor: `${cfg.color}1a` }}
                >
                  {cfg.label}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle>Project palette</SectionTitle>
        <div className="flex flex-wrap gap-3">
          {DEFAULT_PROJECT_COLORS.map((c) => (
            <div key={c} className="flex flex-col items-center gap-1.5">
              <span
                className="h-9 w-9 rounded-full border border-black/5 dark:border-white/10"
                style={{ backgroundColor: c }}
              />
              <span className="font-mono text-[10px] uppercase text-neutral-500">
                {c}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
};
