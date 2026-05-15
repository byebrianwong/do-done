"use client";

import dynamic from "next/dynamic";

export const SortableTaskList = dynamic(
  () => import("./sortable-task-list").then((m) => m.SortableTaskList),
  { ssr: false }
);
