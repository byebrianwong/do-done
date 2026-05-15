"use client";

import dynamic from "next/dynamic";

export const DraggableUpcoming = dynamic(
  () => import("./draggable-upcoming").then((m) => m.DraggableUpcoming),
  { ssr: false }
);
