/**
 * Rules for `components/BottomSheet.tsx`, kept apart so the node suite can
 * check them (there is no renderer in `apps/mobile`).
 *
 * The motion itself reuses `lib/sheet-motion.ts`, the task editor's policy:
 * the same open and close timings, the same release rule for a drag, and the
 * same backdrop derived from the sheet's position. The functions here are the
 * parts the editor did not need: the bottom padding a menu sheet needs inside
 * an edge-to-edge `Modal`, how long an exit takes from part way down, and when
 * a row's follow-up action may run.
 */

import { SHEET_CLOSE_MIN_MS, SHEET_CLOSE_MS, closeDurationMs } from "./sheet-motion";

/**
 * Space under the last row when the device reports no bottom inset.
 *
 * This is the 28px the menu sheets used before they shared a component, so a
 * phone with no gesture bar looks exactly as it did.
 */
export const SHEET_MIN_BOTTOM_PAD = 28;

/** Space kept between the last row and the system's own bottom bar. */
export const SHEET_INSET_GAP = 12;

/**
 * Bottom padding for a sheet's content.
 *
 * A `Modal` window is edge-to-edge in this app. React Native 0.81's
 * `ReactModalHostView` reports `navigationBarTranslucent` as true whenever the
 * edge-to-edge flag is on, and `edgeToEdgeEnabled` turns it on. So the sheet is
 * drawn under the navigation bar, and a fixed 28px put the last row under
 * three-button navigation (48dp). The inset is added, with a floor so a phone
 * without one keeps the old spacing.
 */
export function sheetBottomPadding(insetBottom: number): number {
  const inset = Number.isFinite(insetBottom) && insetBottom > 0 ? insetBottom : 0;
  return Math.max(SHEET_MIN_BOTTOM_PAD, inset + SHEET_INSET_GAP);
}

/**
 * How long the closing sweep takes from where the sheet is now.
 *
 * `velocityY` is the release speed of a drag that dismissed the sheet, or 0
 * when it was closed some other way (backdrop, back button, a picked row).
 * A drag release keeps its speed (`closeDurationMs`). Anything else takes the
 * ordinary close, shortened by however far down the sheet already is, so a
 * sheet half off the screen does not take a full close to leave.
 */
export function exitDurationMs(
  translateY: number,
  velocityY: number,
  sheetHeight: number
): number {
  "worklet";
  if (sheetHeight <= 0) return 0;
  if (velocityY > 0) return closeDurationMs(translateY, velocityY, sheetHeight);
  const remaining = 1 - Math.min(Math.max(translateY / sheetHeight, 0), 1);
  if (remaining <= 0) return 0;
  return Math.max(SHEET_CLOSE_MS * remaining, SHEET_CLOSE_MIN_MS);
}

/**
 * When a row's follow-up may run, relative to the sheet it was tapped in.
 *
 * - `after-dismiss`: iOS. A `Modal` presented while another is still
 *   dismissing never appears, with no error. So an action that opens another
 *   sheet, an Alert or a picker waits for the native `onDismiss`.
 * - `inline`: Android. It has no such problem, and `Modal.onDismiss` is
 *   iOS-only, so waiting would wait forever.
 */
export type AfterDismissMode = "after-dismiss" | "inline";

export function afterDismissMode(os: string): AfterDismissMode {
  return os === "ios" ? "after-dismiss" : "inline";
}
