# Implementation plan — Task input redesign

> **Historical plan.** Executed as PRs #5–#10 in May 2026. **Superseded in part:** the `when_bucket` soft-scheduling column described throughout (PR 1 schema, PR 2 parser `/later` & `/someday`, the `WhenBucket` enum, the date/bucket mutual-exclusion rule) was **removed** by migration `20260616000001`. Scheduling is now always a concrete `when_date`; friendly labels resolve to real dates via `resolveQuickSchedule()`. Read the `when_bucket` sections below as historical context only.

**Source of truth**: `~/.gstack/projects/byebrianwong-do-done/designs/task-input-20260510/round7-{desktop,mobile}.html`
**Approved**: 2026-05-11 (round 7 of 7 iterations — see `approved.json` for history)
**Branch base**: `main` (HEAD `8b78b55c4f` at planning time)

## Scope

Replace `apps/web/src/components/task-edit-dialog.tsx` and `apps/mobile/components/TaskEditModal.tsx` with the round-7 design. The visible changes the user will see:

- Slash-command input with inline pill rendering
- 7-day Sun-Sat "when" calendar (expandable to 14) showing busyness dots per day
- 4-bar signal-strength priority icon
- 6-bar equalizer estimate icon
- Inline tag chips, demoted `+ deadline` link
- Autosave — no Save button. Bottom-right "Done · all saved" button doubles as exit + saved confirmation.
- "Undo all changes" / "Cancel" reverts everything since the modal opened.

Underneath: a new "when date" concept distinct from "due date", subtask support, and a busyness query that combines Supabase tasks + Google Calendar events.

## Execution order (6 PRs)

PRs are sized so each one ships independently and gets its own Chromatic review. Dependencies are linear except where noted.

### PR 1 — Schema migration: when_date, when_bucket, parent_task_id, depth

**Files**:
- `supabase/migrations/20260512000001_add_when_date_when_bucket.sql` (new)
- `supabase/migrations/20260512000002_add_subtask_support.sql` (new)
- `packages/shared/src/types.ts` (extend `Task` type)
- `packages/shared/src/schemas.ts` (extend Zod schema)

**Migration shape**:

```sql
-- 20260512000001_add_when_date_when_bucket.sql
alter table public.tasks
  add column when_date date,
  add column when_bucket text check (
    when_bucket in ('today','tomorrow','this_week','next_week','later','someday')
  );

create index tasks_when_date_idx on public.tasks (user_id, when_date) where when_date is not null;
create index tasks_when_bucket_idx on public.tasks (user_id, when_bucket) where when_bucket is not null;
```

```sql
-- 20260512000002_add_subtask_support.sql
alter table public.tasks
  add column parent_task_id uuid references public.tasks(id) on delete cascade,
  add column depth integer not null default 0 check (depth in (0, 1, 2));

create index tasks_parent_idx on public.tasks (parent_task_id) where parent_task_id is not null;
create index tasks_depth_idx on public.tasks (user_id, depth);

-- Trigger to enforce depth on insert/update — depth = parent.depth + 1, max 2
create or replace function public.tasks_enforce_depth()
returns trigger language plpgsql as $$
declare
  parent_depth integer;
begin
  if new.parent_task_id is null then
    new.depth := 0;
  else
    select depth into parent_depth from public.tasks where id = new.parent_task_id;
    if parent_depth is null then
      raise exception 'parent_task_id % not found', new.parent_task_id;
    end if;
    if parent_depth >= 2 then
      raise exception 'cannot nest deeper than 3 levels (parent already at depth %)', parent_depth;
    end if;
    new.depth := parent_depth + 1;
  end if;
  return new;
end $$;

create trigger tasks_enforce_depth_trigger
  before insert or update of parent_task_id on public.tasks
  for each row execute function public.tasks_enforce_depth();
```

**Semantics — when_date vs when_bucket** (the two columns are mutually exclusive — at most one is set):

- **when_date** = "I'm doing this on a specific calendar day." Picked when user clicks a specific cell in the calendar grid (Today, Tomorrow, or any visible day). Stored as a real date like `2026-05-12`. The day of the week is implicit. If the day passes without completion, the task becomes overdue.

- **when_bucket** = "I'm committing to a fuzzy window, no specific day." Picked when user clicks one of the bucket chips: This week / Next week / Later / Someday. The system doesn't pin it to a date — it lives in a bucket and the user fishes it out whenever during that window.

The model splits two intents that look the same but feel different:
- "I'll do it Wednesday" → when_date
- "I'll do it sometime this week" → when_bucket = 'this_week'

The "Today" picker writes when_date = today (not when_bucket = 'today') — it's a specific day. The 'today' value in the when_bucket enum is reserved for an edge case we may add later (a task that should always feel like "today" until done). Default behavior: today/tomorrow always go to when_date.

**Type changes**:

```ts
// packages/shared/src/types.ts
export type WhenBucket = 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'later' | 'someday';

export type Task = {
  // ...existing fields
  when_date: string | null;        // YYYY-MM-DD — specific calendar day
  when_bucket: WhenBucket | null;  // soft window — mutually exclusive with when_date
  parent_task_id: string | null;   // self-reference for subtasks
  depth: 0 | 1 | 2;                // 0 = main, 1 = subtask, 2 = sub-subtask
};
```

**Zod schema** adds a refinement: at most one of `when_date` and `when_bucket` is non-null.

**Tests**: extend `@do-done/shared` tests to cover (a) when_date/when_bucket mutual exclusion, (b) depth trigger fires on insert with deep parent.

**Risk**: low. Pure additions, no breaking changes to existing queries. The trigger is the one moving piece — needs a test that intentionally tries to nest 4 levels and asserts it errors.

---

### PR 2 — Task engine: extend parser for new grammar

**Files**:
- `packages/task-engine/src/parser.ts` (extend `parseTaskInput`)
- `packages/task-engine/src/parser.test.ts` (new test cases)

**Grammar additions**:
- `/p1` `/p2` `/p3` `/p4` → priority (already partial; consolidate)
- `/today` `/tomorrow` → set `when_date` to today/tomorrow (clears `when_bucket`)
- `/week` `/this-week` → set `when_bucket = 'this_week'` (clears `when_date`)
- `/next-week` → set `when_bucket = 'next_week'` (clears `when_date`)
- `/later` → set `when_bucket = 'later'` (clears `when_date`)
- `/someday` → set `when_bucket = 'someday'` (clears `when_date`)
- `~30m` `~1h` `~2h` `~4h` `~8h` `~16h` → `duration_minutes` (snap to nearest bucket)
- `@<date>` → `due_date` (already works)
- `#<tag>` → tags (already works)

**Return shape**:
```ts
type ParsedInput = {
  title: string;
  priority?: TaskPriority;
  when_date?: string;       // mutually exclusive with when_bucket
  when_bucket?: WhenBucket; // mutually exclusive with when_date
  due_date?: string;
  due_time?: string;
  duration_minutes?: number;
  tags?: string[];
  // recurrence_rule etc unchanged
};
```

**Risk**: low. Parser is pure, well-tested.

---

### PR 3 — api-client: busyness query

**Files**:
- `packages/api-client/src/busyness.ts` (new module)
- `packages/api-client/src/index.ts` (export)

**API**:

```ts
export type BusyItem = {
  type: 'task' | 'event';
  id: string;
  title: string;
  duration_minutes: number;
  priority?: TaskPriority; // tasks only
  start_time?: string;     // events only
};

export type DayBusyness = {
  date: string; // YYYY-MM-DD
  items: BusyItem[];
  total_minutes: number;
};

export class BusynessApi {
  async getRange(startDate: string, endDate: string): Promise<{
    data: DayBusyness[];
    error: PostgrestError | null;
  }>;
}
```

**Implementation**:
- Tasks: `select id, title, when_date, duration_minutes, priority from tasks where user_id = ? and when_date between ? and ? and status != 'done' and status != 'archived'`
- Events: `select id, summary, start_time, end_time from calendar_sync where user_id = ? and start_time between ? and ?` (per HANDOFF, `calendar_sync` table exists)
- Group by date, compute duration_minutes per item, sort by start_time/created_at

**Risk**: medium. Need to verify `calendar_sync` table shape before implementing.

---

### PR 4 — Autosave hook (shared via api-client)

**Files**:
- `packages/api-client/src/use-autosave-task.ts` (new — single hook used by both web and mobile)
- `packages/api-client/package.json` — add `react` as a peer dep, `use-debounce` as a regular dep
- `packages/api-client/src/index.ts` — export the hook

**Why this can live in api-client**: React hooks are pure React. `useState`, `useEffect`, `useCallback`, `useRef` work identically in React DOM and React Native. The save call goes through the existing `TasksApi`. The debounce library (`use-debounce`) is React-only and renderer-agnostic. No DOM-specific code anywhere. One hook, used by both apps. If a save fires from web and another from mobile within the same window, both land — Supabase is the single source of truth and the user sees consistent state regardless of where they edited.

**Hook contract**:

```ts
function useAutoSaveTask(initial: Task): {
  task: Task;                                                     // current local state
  setField: <K extends keyof Task>(key: K, value: Task[K]) => void;
  undoAll: () => Promise<void>;                                   // revert to snapshot
  hasChanges: boolean;                                            // current != snapshot
  lastSavedAt: Date | null;                                       // for the pulse animation
  isSaving: boolean;                                              // for in-flight indicator
};
```

**Behavior**:
- Snapshot `initial` once on mount (stored in `useRef` so it never changes after the first render)
- `setField` updates local state immediately, fires a 250ms debounced save against `tasks.update(id, patch)`
- `undoAll` flushes any pending debounced save, then writes the full snapshot back, resets local state to snapshot
- `hasChanges` shallow-compares current task fields to snapshot
- `lastSavedAt` updates after each successful save — drives the pulse animation in `<SaveStatusDot>` (the dot pulses for 2s after each `lastSavedAt` change)
- `isSaving` reflects the in-flight state for the topbar indicator

**Edge cases that must be tested**:
- Change field, immediately click undo before the debounce fires → undo should cancel pending save AND issue revert
- Two rapid changes to different fields → both get coalesced into one PATCH
- Network error mid-save → leave local state alone, surface error to caller (UI shows a small "save failed, retrying" near the dot)
- Modal closed while save is in flight → save still completes (don't cancel; the user's intent is the data they entered)

**Risk**: medium. Race conditions between debounce + undo are subtle. Test cases above are mandatory before shipping.

---

### PR 5 — Web implementation

**Files**:
- `apps/web/src/components/task-edit-modal-v2.tsx` (new — clean rewrite, not a refactor of old dialog)
- `apps/web/src/components/task-edit-modal-v2.stories.tsx` (Chromatic coverage)
- `apps/web/src/components/when-calendar.tsx`
- `apps/web/src/components/when-calendar.stories.tsx`
- `apps/web/src/components/priority-signal.tsx`
- `apps/web/src/components/estimate-equalizer.tsx`
- `apps/web/src/components/slash-command-input.tsx`
- `apps/web/src/components/done-button.tsx`

**Migration strategy**: build `task-edit-modal-v2.tsx` alongside the old one. Switch all call sites in one commit (or behind a feature flag if there are many). Delete the old one in PR 6's wake-up.

**Sub-component breakdown**:
- `<WhenCalendar value={when_date | when_bucket} onChange={...} busyness={DayBusyness[]} />`
  - Default: 7-cell row
  - `+ next week` expands to 14
  - Renders busyness dots from `busyness` prop
  - Keyboard: ←/→ navigates, T/O/W/N/L/D shortcuts
- `<PrioritySignal value={priority} onChange={...} />`
  - 4 clickable bars
- `<EstimateEqualizer value={minutes} onChange={...} />`
  - 6 clickable bars (≤30 / 60 / 120 / 240 / 480 / ≥960)
- `<SlashCommandInput value={...} onChange={...} onParsed={parsed => ...} />`
  - Calls `parseTaskInput` from task-engine on each keystroke
  - Renders matched tokens as inline pills via a CSS overlay (text remains editable underneath)
- `<DoneButton onClick={close} />` — primary indigo with green check
- Layout container `<TaskEditModalV2>` that wires `useAutoSaveTask` + busyness query + the sub-components

**Storybook stories**:
- Each sub-component gets its own story
- The full modal gets a "default", "with subtasks", "long title", and "expanded calendar" story
- Stories drive Chromatic regression checks per existing setup

**Risk**: high. This is the biggest single piece. ~600-800 LOC. Plan: build sub-components first with stories, then wire them up.

---

### PR 6 — Mobile implementation

**Files**:
- `apps/mobile/components/task-edit-modal-v2.tsx` (new)
- `apps/mobile/components/when-calendar.tsx`
- `apps/mobile/components/priority-signal.tsx`
- `apps/mobile/components/estimate-equalizer.tsx`
- `apps/mobile/components/slash-command-input.tsx`
- `apps/mobile/components/done-button.tsx`

**Same component breakdown as web**, but React Native primitives:
- `<View>` for layout, `<TextInput>` for the slash-command input, `<Pressable>` for tap targets
- `StyleSheet.create` instead of Tailwind
- `useAutoSaveTask` mobile variant (same contract)
- Calendar grid uses `flex` with `aspectRatio: 1 / 1.3` (taller cells for 2-row dot wrap, per round 6 fix)
- Bottom Done button is fixed-position above the keyboard (apply the same keyboard-listener pattern we used for QuickAddBar in PR #3)

**Storybook coverage**: mobile doesn't have Storybook yet (per HANDOFF gotcha #10). Visual verification via Expo Go on phone.

**Risk**: high. Same scope as web. The keyboard avoidance (input + calendar both fitting above the keyboard on a 390-tall screen) needs careful layout.

---

## Cross-cutting decisions

### Subtasks data model

**Subtasks are full tasks.** Each subtask is a row in the `tasks` table with `parent_task_id` set to its parent. Subtasks have all the same properties as main tasks — priority, when_date, when_bucket, estimate, tags, notes, even sub-subtasks of their own.

**Max 3 levels deep**: main task → subtask → sub-subtask. Sub-subtasks cannot have children. Enforced by the `depth` column + `tasks_enforce_depth` trigger from PR 1. The UI hides the "+ add subtask" affordance on depth-2 tasks.

**Editing a subtask** opens it in the same TaskEditModal — the modal is recursive. Top of the modal shows a breadcrumb when editing a non-root task: `Ship widget v2 / Test on mobile`. Clicking the parent name in the breadcrumb pops back to the parent's modal. Cancel still reverts changes to the currently-shown task only (not the parent).

**Inline subtask list** in the modal shows: checkbox + title + small inline indicators (priority dot, when shorthand, tiny estimate icon if set). Clicking the title opens that subtask in the modal. Clicking the checkbox toggles done state inline (autosaves immediately, no modal needed).

**Why not a separate subtasks table**: subtasks need feature parity with tasks (own dates, own priorities, own subtasks). Separate-table = duplicated code. `parent_task_id` self-reference is the right shape — it's the same model that GitHub Issues, Linear, Jira all use for sub-issues.

### What happens when "next week" is picked but specific day is needed later

User picks "Next week" → `when_bucket = 'next_week'`. Later they want to make it concrete:
- They re-open the modal, calendar shows next week expanded, they click a specific day → `when_date = <that day>, when_bucket = null`

Auto-rolling: a daily cron at midnight could promote `when_bucket = 'today'` tasks (created before today) into `when_date = today`. But maybe better to leave that to the UI's logic — render bucket-only tasks at the top of "Today" view if `when_bucket = 'today'` regardless of `when_date`.

### Google Calendar dots — what if not connected

If user hasn't connected gcal, busyness comes from tasks only. The dots still work, just without the hollow event dots. No empty state needed.

### Keyboard shortcuts that conflict

`~` for estimate, `+` for subtask, `1-4` for priority — these are all single keystrokes that fire when the slash-command input doesn't have focus. When the input has focus, they're just typed characters. Need to capture key events at the modal level and route correctly.

### Existing TaskEditDialog / TaskEditModal usage sites

- `apps/web/src/components/task-item.tsx` opens TaskEditDialog
- `apps/mobile/components/TaskItem.tsx` opens TaskEditModal via onPress
- `apps/mobile/app/(tabs)/index.tsx` (Today) and projects.tsx open it

All call sites need to swap to the v2 modal in PR 5/6. Trivial line changes.

## Verification per PR

- **PR 1**: `supabase db push` applies cleanly; `pnpm --filter @do-done/shared test` passes
- **PR 2**: `pnpm --filter @do-done/task-engine test` covers each new grammar token
- **PR 3**: manual `node` script exercises `BusynessApi.getRange()` against staging data; returns expected shape
- **PR 4**: Storybook story shows autosave behavior; manual test of undo
- **PR 5**: Chromatic visual diffs reviewed; manual test on web at https://dodone.byebrianwong.com after deploy
- **PR 6**: manual test on Android via Expo Go, DevBanner confirms branch, all 4 interactions work (calendar, priority, estimate, subtasks)

## Out of scope (deferred)

- EAS dev client build to test native modules (still HANDOFF item #1)
- Pet activity log integration with the new modal — tasks completed inline via the subtask checkboxes should still tag `actor='user'` (already works)
- `dodone://quick-add` deep link wiring (HANDOFF item #2)
- DNS cleanups, pet decay tuning (HANDOFF items #3, #4)

## Rough effort

| PR | Human days | CC-paced |
|----|-----------|----------|
| 1 Schema | 0.5 | 30 min |
| 2 Parser | 1 | 45 min |
| 3 Busyness API | 1 | 45 min |
| 4 Autosave + Done + Status | 1 | 1 hr |
| 5 Web component | 3 | 3 hr |
| 6 Mobile component | 3 | 3 hr |
| **Total** | **~9.5 days** | **~9 hours of CC time** |

Total ~30x compression. Most of the time is in PR 5 + 6 (real implementation work for ~1500 LOC across two platforms).
