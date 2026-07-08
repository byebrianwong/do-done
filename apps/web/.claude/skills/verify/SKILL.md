---
name: verify
description: Build, launch, and drive the web app's components via Storybook + Playwright to verify UI changes at runtime.
---

# Verifying web UI changes

The Next.js app needs Supabase credentials, but almost every interactive
surface has a Storybook story with mock data — verify there instead.

## Build + launch

```bash
pnpm install
pnpm --filter "@do-done/*" build   # workspace packages must be built first,
                                   # or web's tsc/vite can't resolve @do-done/*
cd apps/web && pnpm storybook --ci # dev server on :6006, ~30s to first load
```

Story iframes load directly (no manager UI needed):
`http://localhost:6006/iframe.html?id=components-draggabletaskgroups--grouped-by-status&viewMode=story`
Story IDs are the kebab-cased `title` + export name from `*.stories.tsx`.

## Drive

Playwright: `npm i playwright-core` in the scratchpad and launch with
`executablePath: "/opt/pw-browsers/chromium"` (a symlink to the real binary —
do NOT `playwright install`).

Gotchas:
- Task rows match `.group\/row`, but `TaskItem` has a *nested* `group/row`
  div, so each task matches twice — dedupe or use outermost-only logic.
- Drag-and-drop uses dnd-kit with a 4px MouseSensor activation distance:
  `mouse.down()` then `mouse.move` ≥ 5px starts the drag; hold to inspect
  mid-drag state; `keyboard.press("Escape")` cancels.
- Drops trigger Supabase writes that fail in Storybook (no env) — the
  optimistic UI still shows the intended result; write errors in the console
  are environmental, not a finding.
- Empty sections ("Later", "Next" in the GroupedByStatus story) have no rows;
  target `section:nth(2)` (Not started) for cross-section drags.

## Checks that matter here

- Layout stability at drag start: measure `getBoundingClientRect().top` of
  section headers/rows before `mouse.down` and during the hold — deltas
  should be 0. Inline composers are hidden with `invisible` (not unmounted)
  during drags and "Drop here" hints fit each list's `min-h` precisely to
  keep this true.
- Typecheck is `npx tsc --noEmit` inside `apps/web` (no typecheck script).
