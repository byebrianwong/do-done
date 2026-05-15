"use client";

import dynamic from "next/dynamic";

// @dnd-kit assigns monotonic accessibility IDs that drift between SSR and
// hydration. Loading WeekView purely on the client side avoids the warning
// without giving up interactivity — first paint shows nothing for ~1 frame.
export const WeekView = dynamic(
  () => import("./week-view").then((m) => m.WeekView),
  { ssr: false }
);
