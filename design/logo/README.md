# DoDone logo explorations

Six app-icon candidates for DoDone. Each SVG is a 1024×1024 full-bleed master —
the OS applies the corner mask (iOS squircle / Android adaptive shape), so keep
backgrounds edge-to-edge and don't bake in rounded corners. Ready-to-use
1024×1024 PNG exports live in `png/`.

All marks stay inside the brand system: the indigo family
(`#a5b4fc → #818cf8 → #6366f1 → #4f46e5`) from `packages/ui/src/theme.ts`,
no second hue.

| # | Name | Idea |
|---|------|------|
| 01 | Double Check | The name, literally: *do* ✓ then *done* ✓✓ — a ghost tick behind a solid one on an indigo gradient. |
| 02 | D Monogram | A bold white D with the check knocked out of its bowl. Strongest at tiny sizes. |
| 03 | Checkbox Breakout | A Things-style checkbox whose tick overshoots the box — done, and then some. Light background. |
| 04 | dd Ligature | Geometric lowercase "dd": first d outlined (to do), second d filled (done). |
| 05 | Progress Ring | The day's loop, all but closed, with the check already inside. White background. |
| 06 | Night Check | Dark-mode mark — gradient tick with an indigo afterglow, Linear-style. |

## Adopting one as the app icon

- **Mobile (Expo):** replace `apps/mobile/assets/images/icon.png` (1024×1024) and
  `adaptive-icon.png` (foreground layer — re-export the mark on a transparent
  background with ~25% safe-zone padding; set the adaptive background color to the
  mark's background in `app.config.ts`).
- **Web:** export 32/180/512 px sizes into `apps/web/public/` for favicon and
  `apple-touch-icon`.
- **Re-exporting PNGs:** any browser works — the exports in `png/` were made with
  headless Chromium at 1024×1024.
