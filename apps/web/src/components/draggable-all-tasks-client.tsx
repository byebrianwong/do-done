"use client";

import dynamic from "next/dynamic";

export const DraggableAllTasks = dynamic(
  () => import("./draggable-all-tasks").then((m) => m.DraggableAllTasks),
  { ssr: false }
);
