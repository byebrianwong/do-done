import { MouseSensor, TouchSensor } from "@dnd-kit/core";
import type { MouseSensorOptions, TouchSensorOptions } from "@dnd-kit/core";
import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from "react";

/**
 * Marker attribute for subtrees that must never initiate a row drag. Put it on
 * any overlay a draggable row renders into its own React subtree — chiefly the
 * task detail modal — where the user needs to select text and move the pointer
 * freely.
 *
 * Usage: `<div {...{ [NO_DND_ATTR]: "" }} …>`
 */
export const NO_DND_ATTR = "data-no-dnd";

/**
 * True when a pointer gesture started inside a `[data-no-dnd]` subtree.
 *
 * dnd-kit spreads a row's drag listeners on the whole row, and React events
 * bubble through the component tree — not the DOM tree — so an event fired
 * inside a modal the row renders still reaches the row's activator even when
 * the modal is a `position: fixed` overlay (or portalled elsewhere). Walking up
 * from the *native* target's DOM ancestry lets us tell the two apart.
 */
function startsInsideNoDndZone(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(`[${NO_DND_ATTR}]`) !== null
  );
}

/**
 * MouseSensor that declines to start a drag when the mousedown lands inside a
 * `[data-no-dnd]` subtree. Without it, highlighting text (mousedown + move) in
 * the open task detail modal bubbles to the underlying row's activator and
 * kicks off a phantom reorder, tearing the modal away. Behaviour is otherwise
 * identical to the stock `MouseSensor` (right-click still never drags).
 */
export class ModalAwareMouseSensor extends MouseSensor {
  static activators = [
    {
      eventName: "onMouseDown" as const,
      handler: (
        { nativeEvent: event }: ReactMouseEvent,
        { onActivation }: MouseSensorOptions
      ) => {
        // 2 === right click; mirror the stock sensor's exclusion.
        if (event.button === 2) return false;
        if (startsInsideNoDndZone(event.target)) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

/**
 * TouchSensor counterpart to {@link ModalAwareMouseSensor}: a long-press that
 * begins inside a `[data-no-dnd]` subtree won't drag the row beneath it.
 */
export class ModalAwareTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: (
        { nativeEvent: event }: ReactTouchEvent,
        { onActivation }: TouchSensorOptions
      ) => {
        if (event.touches.length > 1) return false;
        if (startsInsideNoDndZone(event.target)) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}
