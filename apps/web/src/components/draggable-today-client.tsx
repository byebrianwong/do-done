"use client";

import dynamic from "next/dynamic";

export const DraggableToday = dynamic(
  () => import("./draggable-today").then((m) => m.DraggableToday),
  { ssr: false }
);
