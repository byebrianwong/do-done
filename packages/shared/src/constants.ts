import type { TaskPriority, TaskStatus } from "./schemas.js";

export const PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; color: string; score: number }
> = {
  p1: { label: "Urgent", color: "#ef4444", score: 40 },
  p2: { label: "High", color: "#f97316", score: 30 },
  p3: { label: "Medium", color: "#eab308", score: 20 },
  p4: { label: "Low", color: "#6b7280", score: 10 },
};

export const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; icon: string }
> = {
  inbox: { label: "Inbox", icon: "tray" },
  todo: { label: "To Do", icon: "circle" },
  in_progress: { label: "In Progress", icon: "play" },
  done: { label: "Done", icon: "check" },
  archived: { label: "Archived", icon: "archive" },
};

export const FOCUS_SCORES = {
  OVERDUE: 100,
  DUE_TODAY: 50,
  IN_PROGRESS: 20,
  HAS_TIME_BLOCK: 30,
} as const;

export const DEFAULT_PROJECT_COLORS = [
  "#6366f1", // indigo (primary)
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#ec4899", // pink
];
