import { describe, it, expect, vi, afterEach } from "vitest";
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import type { MouseSensorOptions, TouchSensorOptions } from "@dnd-kit/core";
import {
  ModalAwareMouseSensor,
  ModalAwareTouchSensor,
  NO_DND_ATTR,
} from "./dnd-sensors";

const mouseHandler = ModalAwareMouseSensor.activators[0].handler;
const touchHandler = ModalAwareTouchSensor.activators[0].handler;

// The activators only read `nativeEvent.{button,touches,target}` and the
// options' `onActivation`, so hand-built stand-ins keep the tests readable.
function mouseEvent(button: number, target: EventTarget | null): ReactMouseEvent {
  return { nativeEvent: { button, target } } as unknown as ReactMouseEvent;
}
function touchEvent(count: number, target: EventTarget | null): ReactTouchEvent {
  return {
    nativeEvent: { touches: { length: count }, target },
  } as unknown as ReactTouchEvent;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ModalAwareMouseSensor", () => {
  it("declines to start a drag when the mousedown is inside a [data-no-dnd] subtree", () => {
    document.body.innerHTML = `<div id="row"><div ${NO_DND_ATTR}><span id="text">Title</span></div></div>`;
    const target = document.getElementById("text");
    const onActivation = vi.fn();

    const result = mouseHandler(mouseEvent(0, target), {
      onActivation,
    } as unknown as MouseSensorOptions);

    expect(result).toBe(false);
    expect(onActivation).not.toHaveBeenCalled();
  });

  it("starts a drag for a left mousedown outside any no-dnd zone", () => {
    document.body.innerHTML = `<div id="row"><span id="handle">Row</span></div>`;
    const target = document.getElementById("handle");
    const onActivation = vi.fn();

    const result = mouseHandler(mouseEvent(0, target), {
      onActivation,
    } as unknown as MouseSensorOptions);

    expect(result).toBe(true);
    expect(onActivation).toHaveBeenCalledTimes(1);
  });

  it("never starts a drag on right click", () => {
    document.body.innerHTML = `<div id="row"><span id="handle">Row</span></div>`;
    const onActivation = vi.fn();

    const result = mouseHandler(mouseEvent(2, document.getElementById("handle")), {
      onActivation,
    } as unknown as MouseSensorOptions);

    expect(result).toBe(false);
    expect(onActivation).not.toHaveBeenCalled();
  });
});

describe("ModalAwareTouchSensor", () => {
  it("declines to start a drag when the touch begins inside a [data-no-dnd] subtree", () => {
    document.body.innerHTML = `<div id="row"><div ${NO_DND_ATTR}><span id="text">Title</span></div></div>`;
    const onActivation = vi.fn();

    const result = touchHandler(touchEvent(1, document.getElementById("text")), {
      onActivation,
    } as unknown as TouchSensorOptions);

    expect(result).toBe(false);
    expect(onActivation).not.toHaveBeenCalled();
  });

  it("starts a drag for a single touch outside any no-dnd zone", () => {
    document.body.innerHTML = `<div id="row"><span id="handle">Row</span></div>`;
    const onActivation = vi.fn();

    const result = touchHandler(touchEvent(1, document.getElementById("handle")), {
      onActivation,
    } as unknown as TouchSensorOptions);

    expect(result).toBe(true);
    expect(onActivation).toHaveBeenCalledTimes(1);
  });

  it("ignores multi-touch gestures", () => {
    document.body.innerHTML = `<div id="row"><span id="handle">Row</span></div>`;
    const onActivation = vi.fn();

    const result = touchHandler(touchEvent(2, document.getElementById("handle")), {
      onActivation,
    } as unknown as TouchSensorOptions);

    expect(result).toBe(false);
    expect(onActivation).not.toHaveBeenCalled();
  });
});
