"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Aisle, Project, Task } from "@do-done/shared";
import {
  aisleOptions,
  gotItems,
  groupByAisle,
  itemAisle,
  listSubline,
  openItems,
  summarizeList,
  withAisle,
} from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";

interface ListViewProps {
  list: Project;
  initialItems: Task[];
}

/**
 * A shopping list, on the web.
 *
 * Deliberately *not* `TaskDisplayView`. That component's whole job is the
 * Display menu — group by status, sort by deadline, filter by priority — and
 * every one of those axes is meaningless on a list of things to buy. What it
 * would contribute is chrome; what a list needs is a text field that stays
 * focused and rows big enough to hit.
 *
 * Local state rather than a router refresh per tick: this is the one surface in
 * the app where the user's hands are moving faster than a round trip, and a
 * server re-render between "milk" and "eggs" would eat a keystroke.
 */
export function ListView({ list, initialItems }: ListViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [items, setItems] = useState(initialItems);
  const [draft, setDraft] = useState("");
  const [addedCount, setAddedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The server is the source of truth; re-sync when it sends a different set.
  const idsKey = initialItems.map((t) => `${t.id}:${t.status}`).join(",");
  useEffect(() => {
    setItems(initialItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const open = openItems(items);
  const got = gotItems(items);
  const summary = summarizeList(items);
  const groups = useMemo(() => groupByAisle(open), [open]);

  async function addItem() {
    const title = draft.trim();
    if (!title || busy) return;
    // Cleared *before* the write, not after: the field has to be ready for the
    // next word immediately, which is the whole point of the burst composer.
    setDraft("");
    setBusy(true);
    const api = await getClientTasksApi();
    const { data, error } = await api.create({ title, project_id: list.id });
    setBusy(false);
    inputRef.current?.focus();
    if (error || !data) {
      // Put it back rather than losing what they typed.
      setDraft(title);
      return;
    }
    // Append only if the row isn't already here. The optimistic add and the
    // parent's re-sync are in a race, and which one lands first differs by
    // surface: against Supabase the append wins and `router.refresh()` catches
    // up later, but the demo sandbox's write is synchronous, so its re-render
    // arrives *before* this line and a blind append shows the item twice.
    setItems((prev) =>
      prev.some((t) => t.id === data.id) ? prev : [...prev, data]
    );
    setAddedCount((n) => n + 1);
    startTransition(() => router.refresh());
  }

  async function toggle(item: Task) {
    const nextDone = item.status !== "done";
    setItems((prev) =>
      prev.map((t) =>
        t.id === item.id
          ? {
              ...t,
              status: nextDone ? "done" : "not_started",
              completed_at: nextDone ? new Date().toISOString() : null,
            }
          : t
      )
    );
    const api = await getClientTasksApi();
    if (nextDone) await api.complete(item.id);
    else await api.reopen(item.id);
    startTransition(() => router.refresh());
  }

  /**
   * Move an item to a different aisle.
   *
   * Written as a tag rather than inferred again, so the correction survives
   * every future render *and* every future change to the lexicon — which is
   * the point: the shelf the user is standing at outranks our guess about the
   * word, permanently.
   */
  async function setAisle(item: Task, aisle: Aisle | null) {
    const tags = withAisle(item.tags, aisle);
    setItems((prev) =>
      prev.map((t) => (t.id === item.id ? { ...t, tags } : t))
    );
    const api = await getClientTasksApi();
    await api.update(item.id, { tags });
    startTransition(() => router.refresh());
  }

  async function clearGot() {
    if (got.length === 0) return;
    setItems(open);
    const api = await getClientTasksApi();
    await api.clearGot(list.id);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <p className="text-xs text-neutral-500">{listSubline(summary)}</p>
        {got.length > 0 && (
          <button
            onClick={clearGot}
            className="ml-auto rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 active:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            Clear bought
          </button>
        )}
      </div>

      {/*
        The composer sits at the top and never dismisses. Enter commits and
        clears; focus never leaves. A running count with no undo button of its
        own — each row is one tap from being ticked or deleted, so a separate
        undo affordance here would be a third way to do the same thing.
      */}
      <div className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 dark:border-neutral-800">
        <span aria-hidden className="text-indigo-500">
          +
        </span>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void addItem();
            }
          }}
          placeholder="Add an item — press Enter to keep going"
          className="flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
        />
        {addedCount > 0 && (
          <span className="text-xs tabular-nums text-neutral-400">
            {addedCount} added
          </span>
        )}
      </div>

      {open.length === 0 && got.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-neutral-200 py-12 text-center dark:border-neutral-800">
          <p className="text-sm text-neutral-500">Nothing on this list.</p>
          <p className="mt-1 text-xs text-neutral-400">
            Type above, or add from anywhere with{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">
              #{list.name.toLowerCase().replace(/\s+/g, "")}
            </code>
            .
          </p>
        </div>
      ) : (
        /*
          Grouped by aisle, in walking order — a route through the shop rather
          than an inventory of it. `groupByAisle` returns one unlabelled group
          when there is nothing to gain (too few items, or every item in the
          same aisle, or nothing recognised), so this renders a plain list
          exactly when a plain list is right.
        */
        groups.map((group) => (
          <div key={group.aisle ?? "_"} className="flex flex-col gap-1.5">
            {group.label && (
              <p className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">
                {group.label}
              </p>
            )}
            <ul className="grid gap-x-8 sm:grid-cols-2">
              {group.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onToggle={toggle}
                  onAisle={setAisle}
                />
              ))}
            </ul>
          </div>
        ))
      )}

      {got.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">
            Got it · {got.length}
          </p>
          {/* The cart is never grouped: it's a record of what happened, not a
              route through anything, and aisle headers over it would imply
              there was still something to walk. */}
          <ul className="grid gap-x-8 sm:grid-cols-2">
            {got.map((item) => (
              <ItemRow key={item.id} item={item} onToggle={toggle} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  onToggle,
  onAisle,
}: {
  item: Task;
  onToggle: (t: Task) => void;
  /** Absent in the cart, where an aisle no longer decides anything. */
  onAisle?: (t: Task, aisle: Aisle | null) => void;
}) {
  const done = item.status === "done" || item.status === "cancelled";
  const aisle = itemAisle(item);
  return (
    <li className="group/item flex items-center border-b border-neutral-100 dark:border-neutral-800/70">
      <button
        type="button"
        onClick={() => onToggle(item)}
        aria-pressed={done}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
      >
        <span
          aria-hidden
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
            done
              ? "border-indigo-500 bg-indigo-500 text-white"
              : "border-neutral-300 dark:border-neutral-600"
          }`}
        >
          {done && (
            <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.5 6.2 4.8 8.5 9.5 3.8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        <span
          className={`flex-1 truncate text-sm ${
            done
              ? "text-neutral-400 line-through dark:text-neutral-600"
              : "text-neutral-900 dark:text-neutral-100"
          }`}
        >
          {item.title}
        </span>
      </button>

      {/*
        A native <select>, not a custom popover. It is keyboard-operable and
        screen-reader-labelled for free, and the whole control is "which of
        twelve" — exactly what the element is for. It sits outside the tick
        button because a form control nested in a button is invalid and would
        swallow its own clicks.

        Invisible until the row is hovered or the control itself is focused, so
        a list at rest is a list of words. `sr-only`-style opacity rather than
        `hidden`, so tabbing still reaches it.
      */}
      {onAisle && (
        <label className="shrink-0">
          <span className="sr-only">Aisle for {item.title}</span>
          <select
            value={aisle ?? ""}
            onChange={(e) =>
              onAisle(item, e.target.value ? (e.target.value as Aisle) : null)
            }
            className="cursor-pointer rounded border-0 bg-transparent py-1 pl-1 pr-4 text-[11px] text-neutral-400 opacity-0 transition-opacity focus:opacity-100 group-hover/item:opacity-100 dark:text-neutral-500"
          >
            {/* The empty option is how a correction is undone — back to the
                guess, not to a thirteenth "none" aisle. */}
            <option value="">Other</option>
            {aisleOptions().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </li>
  );
}
