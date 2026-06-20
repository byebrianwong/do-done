/**
 * Deterministic clock for Storybook + Chromatic.
 *
 * Story mocks build their dates from `new Date()` and the components compute the
 * current day with `todayLocalISO()` (also `new Date()`). On a live clock every
 * Chromatic build that runs on a new calendar day re-renders the date-relative
 * stories — overdue chips, "Last synced", the week grid — and reports them as
 * spurious visual changes that have to be re-accepted as baselines.
 *
 * Pinning the argument-less clock to a fixed instant makes the mock data and the
 * components agree on one constant "today", so snapshots are stable from one day
 * to the next. Explicit constructions (`new Date(value)`) still behave normally
 * — only "what time is it right now" (`new Date()` / `Date.now()`) is frozen.
 *
 * Scope: imported once, first thing, from `preview.ts`, so it patches only the
 * Storybook preview iframe. The preview config loads before any story module, so
 * every story/mocks top-level date constant evaluates against the frozen clock.
 * The standalone Vitest suite (`*.test.tsx`) never imports this file or the
 * preview, so the unit tests keep the real clock.
 */
const RealDate = Date;

// 2026-01-15 12:00 local — a Thursday at noon, clear of midnight/DST edges.
const FROZEN_MS = new RealDate(2026, 0, 15, 12, 0, 0).getTime();

class FrozenDate extends RealDate {
  constructor(...args: ConstructorParameters<typeof Date> | []) {
    if (args.length === 0) {
      super(FROZEN_MS);
    } else {
      super(...(args as ConstructorParameters<typeof Date>));
    }
  }

  static now(): number {
    return FROZEN_MS;
  }
}

globalThis.Date = FrozenDate as DateConstructor;
