"use client";

import { useState } from "react";
import { parseTaskInput } from "@do-done/task-engine";
import { PRIORITY_CONFIG } from "@do-done/shared";

export function TaskForm() {
  const [input, setInput] = useState("");
  const parsed = input.trim() ? parseTaskInput(input) : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const result = parseTaskInput(input);
    console.log("Parsed task:", result);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="mb-6">
      <form onSubmit={handleSubmit}>
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 dark:border-neutral-800 dark:bg-neutral-900 dark:focus-within:border-indigo-700 dark:focus-within:ring-indigo-950">
          <svg
            className="h-5 w-5 shrink-0 text-neutral-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a task... (try: 'buy milk tomorrow p2 #groceries')"
            className="flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-600"
          />
        </div>
      </form>

      {/* NLP parsing preview */}
      {parsed && parsed.title && (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-4 text-xs text-neutral-500">
          {parsed.due_date && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              {parsed.due_date}
              {parsed.due_time && ` at ${parsed.due_time}`}
            </span>
          )}
          {parsed.priority && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
              style={{
                color: PRIORITY_CONFIG[parsed.priority].color,
                backgroundColor:
                  PRIORITY_CONFIG[parsed.priority].color + "15",
              }}
            >
              {PRIORITY_CONFIG[parsed.priority].label}
            </span>
          )}
          {parsed.tags &&
            parsed.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
              >
                #{tag}
              </span>
            ))}
          {parsed.project && (
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-600 dark:bg-violet-950 dark:text-violet-400">
              /{parsed.project}
            </span>
          )}
          {parsed.duration_minutes && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              {parsed.duration_minutes}min
            </span>
          )}
        </div>
      )}
    </div>
  );
}
