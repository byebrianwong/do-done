"use client";

import dynamic from "next/dynamic";

export const DraggableTaskGroups = dynamic(
  () => import("./draggable-task-groups").then((m) => m.DraggableTaskGroups),
  { ssr: false }
);
