import { describe, expect, it } from 'vitest';
import type { Project } from '@do-done/shared';
import { todayLocalISO, addDaysLocalISO } from '@do-done/shared';
import { parseWearWrite, wearCreateInput } from './wear-write';

function project(over: Partial<Project> & { id: string }): Project {
  return {
    user_id: 'u1',
    name: over.name ?? 'Home',
    color: '#22c55e',
    icon: null,
    kind: 'tasks',
    sort_order: 0,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as Project;
}

describe('parseWearWrite', () => {
  it('reads the three ops the watch can send', () => {
    expect(parseWearWrite('{"op":"complete","taskId":"t1","value":""}')).toEqual({
      op: 'complete',
      taskId: 't1',
      value: '',
    });
    expect(
      parseWearWrite('{"op":"reschedule","taskId":"t1","value":"2026-09-09"}')
    ).toEqual({ op: 'reschedule', taskId: 't1', value: '2026-09-09' });
    expect(parseWearWrite('{"op":"create","taskId":"","value":"buy milk"}')).toEqual({
      op: 'create',
      taskId: '',
      value: 'buy milk',
    });
  });

  // A watch APK does not ship over OTA, so a watch newer than the phone's bundle
  // is an ordinary state. It must degrade to "ignored", never to a throw — the
  // same task still owes the watch a snapshot afterwards.
  it('returns null rather than throwing on anything it does not recognise', () => {
    expect(parseWearWrite(undefined)).toBeNull();
    expect(parseWearWrite('')).toBeNull();
    expect(parseWearWrite('not json')).toBeNull();
    expect(parseWearWrite('[]')).toBeNull();
    expect(parseWearWrite('{"op":"delete","taskId":"t1"}')).toBeNull();
    expect(parseWearWrite(42 as unknown)).toBeNull();
  });

  it('refuses a write with nothing to write to', () => {
    expect(parseWearWrite('{"op":"complete","taskId":"","value":""}')).toBeNull();
    // Otherwise this lands as a task titled "".
    expect(parseWearWrite('{"op":"create","taskId":"","value":"   "}')).toBeNull();
  });

  it('refuses a reschedule that is not a date', () => {
    expect(
      parseWearWrite('{"op":"reschedule","taskId":"t1","value":"tomorrow"}')
    ).toBeNull();
    expect(parseWearWrite('{"op":"reschedule","taskId":"t1","value":""}')).toBeNull();
  });
});

describe('wearCreateInput', () => {
  it('runs the quick-add parser, which is why a create goes through the phone', () => {
    const input = wearCreateInput('call the bank tomorrow p1', []);
    expect(input.title).toBe('call the bank');
    expect(input.scheduled_date).toBe(addDaysLocalISO(1));
    expect(input.priority).toBe('p1');
  });

  it('files a #token into a project when the phone knows one', () => {
    const input = wearCreateInput('milk #home', [project({ id: 'p-home', name: 'Home' })]);
    expect(input.project_id).toBe('p-home');
    expect(input.tags ?? []).not.toContain('home');
  });

  it('leaves an unmatched #token as a tag', () => {
    const input = wearCreateInput('milk #errand', []);
    expect(input.tags).toContain('errand');
    expect(input.project_id).toBeUndefined();
  });

  // Capture is not triage: the watch has no view context, exactly like the
  // quick-add widget and the launcher shortcut.
  it('never names a status, so the task lands in the inbox default', () => {
    expect('status' in wearCreateInput('buy milk', [])).toBe(false);
  });

  it('reads "due" as a deadline and a bare day as a schedule', () => {
    const scheduled = wearCreateInput('ship it friday', []);
    expect(scheduled.scheduled_date).toBeTruthy();
    expect(scheduled.deadline_date).toBeUndefined();

    const deadline = wearCreateInput('submit report due friday', []);
    expect(deadline.deadline_date).toBeTruthy();
  });

  it('keeps the whole text as the title when the parser finds nothing', () => {
    expect(wearCreateInput('  water the plants  ', []).title).toBe('water the plants');
  });

  it('omits every field the text did not mention', () => {
    const input = wearCreateInput('water the plants', []);
    expect(Object.keys(input)).toEqual(['title']);
  });

  it('carries a parsed time only alongside its date', () => {
    const input = wearCreateInput('standup today 9am', []);
    expect(input.scheduled_date).toBe(todayLocalISO());
    expect(input.scheduled_time).toBeTruthy();
  });
});
