import { describe, it, expect, vi, beforeEach } from 'vitest';
import { todayLocalISO, addDaysLocalISO } from '@do-done/shared';

const listCompleted = vi.fn();
vi.mock('./supabase', () => ({
  getTasksApi: async () => ({ listCompleted }),
}));

// Imported after the mock so the module picks it up, and re-imported per test
// because the cache it owns is module-scoped by design.
async function freshModule() {
  vi.resetModules();
  return import('./completion-streak');
}

/** A local timestamp on a given local day. */
function at(day: string, hour = 12): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
}

const TODAY = todayLocalISO();
const YESTERDAY = addDaysLocalISO(-1);
const TWO_DAYS_AGO = addDaysLocalISO(-2);

beforeEach(() => {
  listCompleted.mockReset();
});

describe('claimStreakDay', () => {
  it('says no before the history has loaded', async () => {
    // Not a guess either way — an unknown history costs a burst rather than
    // inventing one.
    const m = await freshModule();
    expect(m.claimStreakDay()).toBe(false);
  });

  it('fires for the first completion of a day that continues a run', async () => {
    listCompleted.mockResolvedValue({
      data: [{ completed_at: at(YESTERDAY) }, { completed_at: at(TWO_DAYS_AGO) }],
      error: null,
    });
    const m = await freshModule();
    await m.loadCompletionStreak();
    expect(m.claimStreakDay()).toBe(true);
  });

  it('does not fire again later the same day', async () => {
    listCompleted.mockResolvedValue({
      data: [{ completed_at: at(YESTERDAY) }],
      error: null,
    });
    const m = await freshModule();
    await m.loadCompletionStreak();
    expect(m.claimStreakDay()).toBe(true);
    // The claim recorded today, so the next completion is an ordinary one.
    expect(m.claimStreakDay()).toBe(false);
    expect(m.claimStreakDay()).toBe(false);
  });

  it('marks the day even when the answer was no, so nothing can re-claim it', async () => {
    // A completion that starts a run rather than continuing one still means
    // the user worked today.
    listCompleted.mockResolvedValue({
      data: [{ completed_at: at(TWO_DAYS_AGO) }],
      error: null,
    });
    const m = await freshModule();
    await m.loadCompletionStreak();
    expect(m.claimStreakDay()).toBe(false);
    expect(m.claimStreakDay()).toBe(false);
  });

  it('does not fire when today already had a completion before launch', async () => {
    listCompleted.mockResolvedValue({
      data: [{ completed_at: at(TODAY, 9) }, { completed_at: at(YESTERDAY) }],
      error: null,
    });
    const m = await freshModule();
    await m.loadCompletionStreak();
    expect(m.claimStreakDay()).toBe(false);
  });

  it('stays silent when the history cannot be read', async () => {
    // A streak is a garnish on an animation; a failed read must not break
    // completing a task, and must not guess.
    listCompleted.mockRejectedValue(new Error('offline'));
    const m = await freshModule();
    await m.loadCompletionStreak();
    expect(m.claimStreakDay()).toBe(false);
  });

  it('stays silent when the query returns an error', async () => {
    listCompleted.mockResolvedValue({ data: [], error: new Error('nope') });
    const m = await freshModule();
    await m.loadCompletionStreak();
    expect(m.claimStreakDay()).toBe(false);
  });

  it('loads once however many callers ask', async () => {
    listCompleted.mockResolvedValue({
      data: [{ completed_at: at(YESTERDAY) }],
      error: null,
    });
    const m = await freshModule();
    await Promise.all([
      m.loadCompletionStreak(),
      m.loadCompletionStreak(),
      m.loadCompletionStreak(),
    ]);
    await m.loadCompletionStreak();
    expect(listCompleted).toHaveBeenCalledTimes(1);
  });

  it('forgets the history on sign-out, so the next account starts clean', async () => {
    listCompleted.mockResolvedValue({
      data: [{ completed_at: at(YESTERDAY) }],
      error: null,
    });
    const m = await freshModule();
    await m.loadCompletionStreak();
    m.resetCompletionStreak();
    // Nothing loaded means nothing claimable — the previous user's run must not
    // be inherited.
    expect(m.claimStreakDay()).toBe(false);
    await m.loadCompletionStreak();
    expect(listCompleted).toHaveBeenCalledTimes(2);
  });
});
