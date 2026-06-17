# Task input redesign

> **Historical design doc.** This records the original task-input redesign as approved in May 2026. **One concept has since been removed:** the soft `when_bucket` scheduling windows (`Later` / `Someday` / `This week` / etc.). Scheduling is now always a concrete `when_date`; the friendly labels below (This week, This weekend, Next week) resolve to real calendar dates via `resolveQuickSchedule()` in `@do-done/shared`. Ignore the `when_bucket` parts of this doc — see the README's "scheduling" section for current behavior.

Approved design + implementation plan for the new task edit experience that replaces `apps/web/src/components/task-edit-dialog.tsx` and `apps/mobile/components/TaskEditModal.tsx`.

## Files

| File | What |
|---|---|
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | 6-PR implementation plan with schema migrations, parser changes, autosave hook, and per-app components |
| [`round7-board.html`](round7-board.html) | Side-by-side comparison of desktop + mobile |
| [`round7-desktop.html`](round7-desktop.html) | Final desktop mockup (640px modal) |
| [`round7-mobile.html`](round7-mobile.html) | Final mobile mockup (390px phone frame) |

Open the HTML files in any browser — they're self-contained, no server needed. Just inline CSS + Google Fonts.

## Design summary

- **Slash-command input** with inline pill rendering for `/p1`, `#tags`, `~2h`, `@<date>`
- **"When" calendar** — 7-day Sun-Sat grid (expandable to 14), today highlighted with an indigo dot, past days dimmed. The killer interaction: instant re-scheduling without dropdowns.
- **Busyness dots** — each event/task on a day is a tiny pill at the bottom of its cell. Width = duration (30m thin → 8h wide), color = priority (p1 red, p2 amber, p3 indigo, p4 grey), hollow outline = calendar event (no priority). Glanceable at-a-day load.
- **Soft buckets** — `+ next week` expansion plus `Later` / `Someday` / `Pick day…` chips for tasks that don't have a specific calendar day
- **4-bar signal-strength priority icon** + **6-bar equalizer estimate icon** — both compact, click any bar to set, color-coded
- **`when_date` vs `when_bucket`** (new schema concept, distinct from existing `due_date`):
  - `when_date` = "I'm doing this on May 12" (specific calendar day)
  - `when_bucket` = "I'm doing this sometime this week" (fuzzy window)
  - At most one is set
- **Subtasks** are full tasks (own properties, own subtasks). Max 3 levels deep. Recursive edit modal.
- **Autosave** — no Save button. Every field change debounce-saves at 250ms. The bottom-right "✓ Done · all saved" button (desktop) or fixed-bottom "✓ Done · all saved" button (mobile) doubles as exit + saved confirmation.
- **Cancel = revert** all changes since the modal opened (undo button restores the snapshot).

## Iteration history

This design went through 7 rounds. Full iteration log including every variant explored is in `~/.gstack/projects/byebrianwong-do-done/designs/task-input-20260510/approved.json`.

Rough arc:
1. **Round 1** — 5 wide-spread directions (Constellation / Command Stage / Drawer Workshop / Spatial Canvas / Sticker Sheet)
2. **Round 2** — pills vs slider exploration for "when"
3. **Round 3** — added 14-day Sun-Sat calendar + 4-bar priority + 6-bar estimate
4. **Round 4** — collapsed to single week by default + busyness fill bar + softer weekends
5. **Round 5** — busyness as dots (the breakthrough viz) + ⌄ chevron + mobile view
6. **Round 6** — hidden legend + chevron retired + mobile dots wrap to 2 rows + autosave
7. **Round 7** — Done button as exit + saved indicator (final)

## Status

- ✅ Design approved 2026-05-11
- ✅ Plan documented in `IMPLEMENTATION_PLAN.md`
- ⏳ Implementation: PR 1 (schema migration) is the next step
