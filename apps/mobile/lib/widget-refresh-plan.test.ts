import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LIST_WIDGET, REFRESHED_WIDGET_NAMES, widgetRefreshPlan } from './widget-refresh-plan';

describe('widgetRefreshPlan', () => {
  it('reads nothing when no widget is placed', () => {
    // The common case. The task read used to run after every write anyway.
    expect(widgetRefreshPlan(new Set())).toEqual({ tasks: false, lists: false });
  });

  it('does the shared task read for any one of the task widgets', () => {
    for (const name of ['Today', 'Upcoming', 'NextUp']) {
      expect(widgetRefreshPlan(new Set([name]))).toEqual({ tasks: true, lists: false });
    }
  });

  it('skips the shared read when only a List widget is placed', () => {
    expect(widgetRefreshPlan(new Set([LIST_WIDGET]))).toEqual({
      tasks: false,
      lists: true,
    });
  });

  it('ignores the Quick Add tile, which has its own repaint', () => {
    expect(widgetRefreshPlan(new Set(['QuickAdd']))).toEqual({
      tasks: false,
      lists: false,
    });
    expect(REFRESHED_WIDGET_NAMES).not.toContain('QuickAdd');
  });

  it("names the List widget the way widget-list-data.ts does", () => {
    // Read as text: importing that module pulls in Supabase. A mismatch would
    // leave List widgets never redrawn from the app, with no error.
    const source = readFileSync(
      join(__dirname, '..', 'widgets', 'widget-list-data.ts'),
      'utf8'
    );
    expect(source).toMatch(
      new RegExp(`export const LIST_WIDGET_NAME = '${LIST_WIDGET}';`)
    );
  });
});
