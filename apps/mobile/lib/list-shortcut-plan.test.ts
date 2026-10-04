import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_SHOPPING_ID } from '@do-done/shared';

import {
  ALL_SHOPPING_SHORT_LABEL,
  LIST_SHORTCUT_PREFIX,
  allShoppingShortcut,
  LONG_LABEL_MAX,
  SHORT_LABEL_MAX,
  listIdFromShortcutId,
  listShortcutFor,
  listShortcutId,
  listShortcutUrl,
  planListShortcuts,
  truncateLabel,
} from './list-shortcut-plan';

const list = (id: string, name: string, color = '#6366f1') => ({
  id,
  name,
  color,
});

const GROCERIES = list('11111111-1111-1111-1111-111111111111', 'Groceries');
const HARDWARE = list('22222222-2222-2222-2222-222222222222', 'Hardware');

describe('listShortcutId', () => {
  it('round-trips a list id', () => {
    const id = listShortcutId(GROCERIES.id);
    expect(id).toBe(`${LIST_SHORTCUT_PREFIX}${GROCERIES.id}`);
    expect(listIdFromShortcutId(id)).toBe(GROCERIES.id);
  });

  it('does not claim the static quick actions', () => {
    // The sync diffs what the launcher is holding and disables what is no
    // longer a list. Claiming one of these would disable Add task.
    for (const staticId of ['quick-add', 'voice-add', 'search', 'today', 'upcoming']) {
      expect(listIdFromShortcutId(staticId)).toBeNull();
    }
  });

  it('is stable for the life of the list, so a pinned icon survives a rename', () => {
    const renamed = { ...GROCERIES, name: 'Big shop' };
    expect(listShortcutFor(renamed).id).toBe(listShortcutFor(GROCERIES).id);
    expect(listShortcutFor(renamed).shortLabel).not.toBe(
      listShortcutFor(GROCERIES).shortLabel
    );
  });
});

describe('truncateLabel', () => {
  it('leaves a name that fits alone, trimmed', () => {
    expect(truncateLabel('  Groceries  ', SHORT_LABEL_MAX)).toBe('Groceries');
  });

  it('cuts on a word boundary when one is worth using', () => {
    expect(truncateLabel('Hardware store', SHORT_LABEL_MAX)).toBe('Hardware…');
  });

  it('cuts mid-word when there is no boundary to use', () => {
    expect(truncateLabel('Supercalifragilistic', SHORT_LABEL_MAX)).toBe(
      'Supercali…'
    );
  });

  it('ignores a boundary that would throw most of the name away', () => {
    // The last space in "A very lo" is at index 1 as well as 6. Taking the
    // first would leave "A…", which says nothing at all; the rule is that a
    // boundary has to leave at least half the budget spent.
    expect(truncateLabel('A very long list name', SHORT_LABEL_MAX)).toBe(
      'A very…'
    );
    expect(truncateLabel('A bcdefghijkl', SHORT_LABEL_MAX)).toBe('A bcdefgh…');
  });

  it('never exceeds the budget', () => {
    for (const name of [
      'Groceries',
      'Hardware store',
      'Supercalifragilisticexpialidocious',
      'A very long list name indeed',
    ]) {
      expect(truncateLabel(name, SHORT_LABEL_MAX).length).toBeLessThanOrEqual(
        SHORT_LABEL_MAX
      );
      expect(truncateLabel(name, LONG_LABEL_MAX).length).toBeLessThanOrEqual(
        LONG_LABEL_MAX
      );
    }
  });
});

describe('listShortcutFor', () => {
  it('carries the list name, colour and deep link', () => {
    expect(listShortcutFor(GROCERIES)).toEqual({
      id: `${LIST_SHORTCUT_PREFIX}${GROCERIES.id}`,
      shortLabel: 'Groceries',
      longLabel: 'Groceries',
      url: `dodone://lists/${GROCERIES.id}`,
      color: '#6366f1',
    });
  });

  it('never produces an empty label', () => {
    // ShortcutInfoCompat.Builder throws on one, which would take the whole
    // sync down over a single malformed row.
    expect(listShortcutFor(list(GROCERIES.id, '   ')).shortLabel).toBe('List');
  });
});

describe('planListShortcuts', () => {
  it('gives every list a shortcut, then All shopping', () => {
    const plan = planListShortcuts({
      lists: [GROCERIES, HARDWARE],
      lastListId: null,
    });
    expect(plan.shortcuts.map((s) => s.shortLabel)).toEqual([
      'Groceries',
      'Hardware',
      ALL_SHOPPING_SHORT_LABEL,
    ]);
  });

  it('puts the remembered list in the menu slot', () => {
    const plan = planListShortcuts({
      lists: [GROCERIES, HARDWARE],
      lastListId: HARDWARE.id,
    });
    expect(plan.dynamicId).toBe(listShortcutId(HARDWARE.id));
  });

  it('falls back to the first list when nothing is remembered', () => {
    const plan = planListShortcuts({
      lists: [GROCERIES, HARDWARE],
      lastListId: null,
    });
    expect(plan.dynamicId).toBe(listShortcutId(GROCERIES.id));
  });

  it('ignores a remembered list that no longer exists', () => {
    // Deleted on the laptop. Pointing the launcher at it would be an icon that
    // opens an empty screen — the same reason `resumeDecision` checks the ids.
    const plan = planListShortcuts({
      lists: [GROCERIES],
      lastListId: HARDWARE.id,
    });
    expect(plan.dynamicId).toBe(listShortcutId(GROCERIES.id));
  });

  it('has no menu entry when there are no lists', () => {
    expect(planListShortcuts({ lists: [], lastListId: null })).toEqual({
      shortcuts: [allShoppingShortcut()],
      dynamicId: null,
    });
  });

  it('keeps All shopping in the plan with no lists, so its pinned icon is not called deleted', () => {
    // Everything pinned and absent from the plan is disabled with "This list
    // was deleted." The combined view is not a list and was not deleted.
    const plan = planListShortcuts({ lists: [], lastListId: null });
    expect(plan.shortcuts.map((s) => s.id)).toContain(
      listShortcutId(ALL_SHOPPING_ID)
    );
  });

  it('gives All shopping the menu slot when it was the last list screen', () => {
    const plan = planListShortcuts({
      lists: [GROCERIES, HARDWARE],
      lastListId: ALL_SHOPPING_ID,
    });
    expect(plan.dynamicId).toBe(listShortcutId(ALL_SHOPPING_ID));
  });

  it('never falls back to All shopping when nothing is remembered', () => {
    // The fallback exists to put *a list* in front of someone who has never
    // opened one from the tab.
    const plan = planListShortcuts({
      lists: [GROCERIES, HARDWARE],
      lastListId: null,
    });
    expect(plan.dynamicId).not.toBe(listShortcutId(ALL_SHOPPING_ID));
  });

  it('only ever names one menu entry', () => {
    // Most launchers show four entries in the long-press menu and prefer the
    // manifest ones, so a second dynamic shortcut would evict a second static
    // quick action and gain nothing.
    const plan = planListShortcuts({
      lists: [GROCERIES, HARDWARE],
      lastListId: GROCERIES.id,
    });
    expect(plan.shortcuts.filter((s) => s.id === plan.dynamicId)).toHaveLength(1);
  });
});

describe('allShoppingShortcut', () => {
  it('fits its short label without truncation', () => {
    expect(allShoppingShortcut().shortLabel.length).toBeLessThanOrEqual(
      SHORT_LABEL_MAX
    );
    expect(allShoppingShortcut().longLabel).toBe('All shopping');
  });

  it('opens a route that exists', () => {
    expect(allShoppingShortcut().url).toBe('dodone://lists/shopping');
    expect(
      existsSync(
        resolve(__dirname, '..', 'app', '(tabs)', 'lists', 'shopping.tsx')
      )
    ).toBe(true);
  });

  it('has an id the sync treats as one of its own', () => {
    expect(allShoppingShortcut().id.startsWith(LIST_SHORTCUT_PREFIX)).toBe(true);
  });
});

describe('listShortcutUrl', () => {
  it('points at a route that exists', () => {
    // A shortcut whose deep link has no route opens the app on whatever screen
    // it was last showing, which looks like the shortcut working badly rather
    // than like a broken link. Same check the static shortcuts get.
    const url = listShortcutUrl(GROCERIES.id);
    expect(url.startsWith('dodone://lists/')).toBe(true);
    expect(
      existsSync(resolve(__dirname, '..', 'app', '(tabs)', 'lists', '[id].tsx'))
    ).toBe(true);
  });
});
