"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type {
  Aisle,
  AisleMemory,
  PantryBand,
  PantryEntry,
  Project,
  Task,
} from "@do-done/shared";
import {
  aisleOptions,
  gotItems,
  groupByAisle,
  itemAisle,
  itemSubline,
  listSubline,
  openItems,
  storeHint,
  storeSuggestions,
  storeTag,
  storesOnList,
  summarizeList,
  typingStoreToken,
  applyStoreToken,
  extractStoreToken,
  withAisle,
  withStoreHint,
  lastBoughtLabel,
  pantryBands,
  searchPantry,
  cadenceLabel,
  dueEntries,
} from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { getClientAisleTermsApi } from "@/lib/supabase/aisle-terms-client";
import { getClientPantryApi } from "@/lib/supabase/pantry-client";
import { useOpenTask } from "@/lib/open-task";
import { ComposerActionGlyph } from "@/components/composer-action-glyph";

interface ListViewProps {
  list: Project;
  initialItems: Task[];
  /**
   * The user's aisle memory, as entries — a Map can't cross the
   * server/client boundary. Optional so the demo sandbox and Storybook can
   * omit it and get the lexicon's guesses, which is the correct fallback.
   */
  memoryEntries?: Array<[string, Aisle]>;
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
export function ListView({
  list,
  initialItems,
  memoryEntries = [],
}: ListViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  /**
   * The app-wide editor. An item is a task, so clicking its words opens the
   * same editor every other row in the app opens — which is where notes, a
   * photo of the label, a store hint and the deadline all live. Null outside
   * the provider (Storybook), and the row falls back to plain text there.
   */
  const openTask = useOpenTask();
  const [items, setItems] = useState(initialItems);
  const [draft, setDraft] = useState("");
  // Whether the composer is live, which is what moves the action glyph to
  // the trailing edge. Text counts as well as focus: a half-typed item the
  // user has clicked away from still has something to commit.
  const [composerFocused, setComposerFocused] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The server is the source of truth; re-sync when it sends a different set.
  // The key carries every field a row draws, not just the id and the status:
  // renaming an item or moving its aisle from the editor changes neither, and
  // a key blind to those leaves the list showing the old word.
  const idsKey = initialItems
    .map((t) => `${t.id}:${t.status}:${t.title}:${(t.tags ?? []).join("|")}`)
    .join(",");
  useEffect(() => {
    setItems(initialItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const open = openItems(items);
  const got = gotItems(items);
  const summary = summarizeList(items);
  /*
    Every store already named on this list, most-used first. Bought items count
    too. The cart holds last week's stores, and a suggestion list that dropped
    them the moment something was ticked would be empty when it is most useful.
  */
  const stores = useMemo(() => storesOnList(items), [items]);
  /*
    Everything ever bought on this list.

    Loaded on the client rather than passed from the server. The drawer changes
    on every tick, so a server prop would be one refresh behind the action that
    changed it. It is also the only source available to the demo sandbox, which
    is why the aisle memory reloads here too.
  */
  const [pantry, setPantry] = useState<PantryEntry[]>([]);
  const reloadPantry = useCallback(async () => {
    const api = await getClientPantryApi();
    const { data } = await api.load(list.id);
    setPantry(data);
  }, [list.id]);
  useEffect(() => {
    void reloadPantry();
  }, [reloadPantry]);
  /*
    Anything already on the list is left out of the drawer and the composer's
    suggestions. Offering to put back what is on screen is noise, and excluding
    it makes an accidental tick self-correcting: un-ticking puts the row back on
    the list, which hides its pantry entry again.
  */
  /*
    Entries past their own measured buying rhythm.

    A sharper version of the three bands. Two weeks and two months approximate a
    rhythm, so they mis-sort some items: rice bought three weeks ago lands next
    to a one-off. Once an item has been bought three times, its own gaps answer
    the question directly.

    The bands remain, and are the right answer while `buy_count` is 1 or 2 —
    which is everything on the first shop after this ships, and a shrinking
    share of entries afterwards.
  */
  const due = useMemo(() => dueEntries(pantry, { onList: items }), [pantry, items]);
  const bands = useMemo(
    // Excluded from the bands below, so nothing is offered twice on one screen.
    () => pantryBands(pantry, { onList: items, exclude: due.map((e) => e.term) }),
    [pantry, items, due]
  );
  const pantryCount = useMemo(
    () => bands.reduce((n, b) => n + b.entries.length, 0),
    [bands]
  );
  // What the composer is typing after an `@`, or null if no token is open. An
  // empty string is a real answer: a bare `@` opens the full list.
  const storeQuery = typingStoreToken(draft);
  const storeMatches = useMemo(
    () => (storeQuery === null ? [] : storeSuggestions(stores, storeQuery)),
    [stores, storeQuery]
  );
  /*
    The composer's memory. A few keystrokes should be enough to put back
    something bought repeatedly, with its store already attached.

    Only runs while no `@` token is open. The two suggestion sets answer
    different questions, and one dropdown cannot mean both at once.
  */
  const pantryMatches = useMemo(
    () =>
      storeQuery !== null
        ? []
        : searchPantry(pantry, draft, { onList: items }),
    [pantry, draft, items, storeQuery]
  );
  /**
   * The aisle memory, seeded from the server and then owned here.
   *
   * Both halves earn their place. The server's copy is what makes the first
   * paint correct — without it a taught list would render in the lexicon's
   * groups and visibly re-shuffle. The client reload is what keeps it fresh
   * after a correction, and it is also the only source the demo sandbox has,
   * which is why this isn't a `memoryEntries`-only prop with a demo special
   * case bolted on beside it.
   */
  const [memory, setMemory] = useState<AisleMemory>(
    () => new Map(memoryEntries)
  );
  const reloadMemory = useCallback(async () => {
    const terms = await getClientAisleTermsApi();
    const { data } = await terms.load();
    setMemory(data);
  }, []);
  useEffect(() => {
    void reloadMemory();
  }, [reloadMemory]);
  const groups = useMemo(
    () => groupByAisle(open, { memory }),
    [open, memory]
  );

  async function addItem() {
    // `@` names a store, the way `#` names a project. Parsed here rather than
    // in `parseTaskInput`, because elsewhere in the app `@` usually means a
    // person. See `extractStoreToken`.
    const { title, store } = extractStoreToken(draft);
    if (!title || busy) return;
    // Cleared *before* the write, not after: the field has to be ready for the
    // next word immediately, which is what the burst composer exists for.
    setDraft("");
    setBusy(true);
    const api = await getClientTasksApi();
    const { data, error } = await api.create({
      title,
      project_id: list.id,
      ...(store ? { tags: [storeTag(store)] } : {}),
    });
    setBusy(false);
    inputRef.current?.focus();
    if (error || !data) {
      // Restore what they typed, `@store` included. Restoring the parsed title
      // would silently drop the store when the network fails.
      setDraft(store ? `${title} @${store}` : title);
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

  /**
   * Adds an item back to the list from the pantry.
   *
   * It arrives with the store it was last bought at. That is the difference
   * between taking a suggestion and typing the word again.
   */
  async function addFromPantry(entry: PantryEntry) {
    if (busy) return;
    setDraft("");
    setBusy(true);
    const api = await getClientTasksApi();
    const { data } = await api.create({
      title: entry.title,
      project_id: list.id,
      ...(entry.store ? { tags: [storeTag(entry.store)] } : {}),
    });
    setBusy(false);
    inputRef.current?.focus();
    if (!data) return;
    setItems((prev) =>
      prev.some((t) => t.id === data.id) ? prev : [...prev, data]
    );
    setAddedCount((n) => n + 1);
    startTransition(() => router.refresh());
  }

  /**
   * Deletes a pantry entry. The only destructive action on this screen.
   *
   * Putting a list away is safe now, so it stays one tap. The friction sits
   * here instead, on the action that cannot be undone.
   */
  async function forget(entry: PantryEntry) {
    setPantry((prev) => prev.filter((e) => e.term !== entry.term));
    const api = await getClientPantryApi();
    await api.forget(list.id, entry.term);
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
    // Ticking writes to the pantry, so the drawer has to reload. Awaited, or
    // the reload races the write that caused it and the entry appears late.
    if (nextDone) await reloadPantry();
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
    // Two writes, and the second one is why this is here. The tag fixes *this*
    // row; the
    // lesson fixes the same words next week, after this item has been cleared
    // and purged. Picking "Automatic" un-teaches, so the lexicon takes the
    // word back rather than a stored blank having to beat it.
    const [api, terms] = await Promise.all([
      getClientTasksApi(),
      getClientAisleTermsApi(),
    ]);
    await api.update(item.id, { tags });
    if (aisle) await terms.learn(item.title, aisle);
    else await terms.forget(item.title);
    await reloadMemory();
    startTransition(() => router.refresh());
  }

  /**
   * Sets or clears an item's store.
   *
   * One write, unlike an aisle correction, which is two. There is no lesson to
   * record: a store describes this purchase, not the words. Buying batteries at
   * Target once does not mean batteries always come from Target, whereas
   * "bananas are produce" is a fact about the language and worth remembering.
   */
  async function setStore(item: Task, store: string | null) {
    const tags = withStoreHint(item.tags, store);
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
          /*
            "Put away", not "Clear bought".

            The write is the same — items are still soft-deleted — but nothing
            important is lost, because each was recorded in the pantry when it
            was ticked. That is why this stays a single unconfirmed tap on one
            of the most repeated actions in the app. Adding friction here would
            cost time every trip to prevent a loss that no longer happens. The
            friction sits on deleting a pantry entry instead, which is the
            action that really cannot be undone.
          */
          <button
            onClick={clearGot}
            title="Move the bought items off the list. They stay in Bought before."
            className="ml-auto rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 active:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            Put away
          </button>
        )}
      </div>

      {/*
        The composer sits at the top and never dismisses. Enter commits and
        clears; focus never leaves. A running count with no undo button of its
        own — each row is one tap from being ticked or deleted, so a separate
        undo affordance here would be a third way to do the same thing.
      */}
      <div className="relative">
        {/*
          The field reserves a gutter on both sides at all times, so the glyph
          has somewhere to sit at either end and the "N added" receipt never
          lands under it. The idle gutter on the right costs 20px of a field
          nothing else was using.
        */}
        <div className="relative flex items-center gap-2 rounded-lg border border-neutral-200 py-2 pl-9 pr-9 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 dark:border-neutral-800">
          <ComposerActionGlyph
            active={composerFocused || draft.length > 0}
            // The same test `addItem` guards on, so the return key is live
            // exactly when pressing it would write something.
            armed={!busy && extractStoreToken(draft).title.length > 0}
            onSubmit={() => void addItem()}
            onFocusField={() => inputRef.current?.focus()}
            idleLabel="Add an item"
            submitLabel="Add this item"
          />
          <input
            ref={inputRef}
            type="text"
            value={draft}
            autoFocus
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              /*
                Tab accepts the top suggestion, and only when there is one.
                This is the binding `SuggestedFacets` already uses, so the two
                never mean different things. With nothing to accept, Tab still
                moves focus as normal.
              */
              if (e.key === "Tab" && !e.shiftKey && storeMatches.length > 0) {
                e.preventDefault();
                setDraft(applyStoreToken(draft, storeMatches[0]));
                return;
              }
              // A pantry hit is added straight away rather than completed
              // into the field. Requiring a second keystroke to confirm would
              // undo the speed the suggestion exists to provide.
              if (e.key === "Tab" && !e.shiftKey && pantryMatches.length > 0) {
                e.preventDefault();
                void addFromPantry(pantryMatches[0]);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                void addItem();
              }
            }}
            placeholder="Add an item to buy"
            className="flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
          />
          {addedCount > 0 && (
            <span className="text-xs tabular-nums text-neutral-400">
              {addedCount} added
            </span>
          )}
        </div>

        {/*
          The stores already on this list, offered while an `@` token is open.
          Two keystrokes and a click covers most shops, and typing a name that
          is not in the list creates it. There is no separate "create" step,
          because the token itself is the store.

          Rendered only when there is something to offer, so a list with no
          stores yet does not show an empty panel on the first `@`.
        */}
        {storeMatches.length === 0 && pantryMatches.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            {pantryMatches.map((entry, i) => (
              <li key={entry.term}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void addFromPantry(entry)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  <span aria-hidden className="text-neutral-400">
                    ↩
                  </span>
                  <span className="truncate">{entry.title}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-neutral-400">
                    {entry.store && <span>{entry.store}</span>}
                    <span>{lastBoughtLabel(entry.last_bought_at)}</span>
                    {i === 0 && (
                      <kbd className="rounded border border-neutral-200 px-1 text-[10px] dark:border-neutral-700">
                        Tab
                      </kbd>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {storeMatches.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            {storeMatches.map((name, i) => (
              <li key={name}>
                <button
                  type="button"
                  // The input must keep focus — this is a burst composer and
                  // the next word is already coming.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setDraft(applyStoreToken(draft, name));
                    inputRef.current?.focus();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  <span aria-hidden className="text-neutral-400">
                    @
                  </span>
                  {name}
                  {i === 0 && (
                    <kbd className="ml-auto rounded border border-neutral-200 px-1 text-[10px] text-neutral-400 dark:border-neutral-700">
                      Tab
                    </kbd>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        Sits above the list rather than inside the drawer. This is a prompt
        about the trip you are about to make, not a record of past ones, so it
        has to be seen before shopping rather than found afterwards.
      */}
      {due.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/20">
          <p className="font-mono text-[10px] uppercase tracking-wider text-indigo-500">
            Probably due
          </p>
          <ul className="flex flex-wrap gap-2">
            {due.map((entry) => (
              <li key={entry.term}>
                <button
                  type="button"
                  onClick={() => void addFromPantry(entry)}
                  title={`${cadenceLabel(entry)} · last bought ${lastBoughtLabel(entry.last_bought_at)}`}
                  className="flex items-center gap-1.5 rounded-full border border-indigo-300 bg-white px-3 py-1.5 text-sm text-neutral-800 hover:border-indigo-500 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span aria-hidden className="text-indigo-500">
                    +
                  </span>
                  {entry.title}
                  <span className="text-xs text-neutral-400">
                    {lastBoughtLabel(entry.last_bought_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
            <ul className="grid gap-x-8 lg:grid-cols-2">
              {group.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onToggle={toggle}
                  onOpen={openTask?.open}
                  onAisle={setAisle}
                  onStore={setStore}
                  stores={stores}
                  memory={memory}
                />
              ))}
            </ul>
          </div>
        ))
      )}

      {/*
        Everything ever bought on this list, in three bands.

        The drawer is what makes "Put away" safe. A ticked item is recorded
        immediately, so putting the list away moves things here rather than
        destroying them, and putting one back is a click.

        Only the first band is open by default. After a year "Earlier" holds
        hundreds of rows, and a list screen should not open two screens below
        its own list. The composer's search is the way into that band.
      */}
      {pantryCount > 0 && (
        <div className="mt-2 flex flex-col gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="font-mono text-[10px] uppercase tracking-wider text-indigo-500">
            Bought before · {pantryCount}
          </p>
          {bands.map((band, i) => (
            <PantryBandView
              key={band.key}
              band={band}
              defaultOpen={i === 0}
              onAdd={addFromPantry}
              onForget={forget}
            />
          ))}
        </div>
      )}

      {got.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">
            Got it · {got.length}
          </p>
          {/* The cart is never grouped: it's a record of what happened, not a
              route through anything, and aisle headers over it would imply
              there was still something to walk. */}
          <ul className="grid gap-x-8 lg:grid-cols-2">
            {got.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={toggle}
                onOpen={openTask?.open}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Renders one band of the pantry drawer.
 *
 * Uses <details> rather than a hand-rolled disclosure. The element is exactly
 * open/closed state with a label, and it is keyboard-operable and announced to
 * screen readers without extra work.
 */
function PantryBandView({
  band,
  defaultOpen,
  onAdd,
  onForget,
}: {
  band: PantryBand;
  defaultOpen: boolean;
  onAdd: (entry: PantryEntry) => void;
  onForget: (entry: PantryEntry) => void;
}) {
  return (
    <details open={defaultOpen} className="group/band">
      <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-wider text-neutral-400 marker:content-none hover:text-neutral-600 dark:hover:text-neutral-300">
        <span aria-hidden className="inline-block w-3 transition-transform group-open/band:rotate-90">
          ›
        </span>
        {band.label} · {band.entries.length}
      </summary>
      <ul className="mt-1 grid gap-x-8 lg:grid-cols-2">
        {band.entries.map((entry) => (
          <li
            key={entry.term}
            className="group/pantry flex items-center gap-2 border-b border-neutral-100 py-1 dark:border-neutral-800/70"
          >
            {/*
              The name is the button. Unlike an item row, nothing else competes
              for the tap: a pantry entry has one possible action, so the words
              can be the target.
            */}
            <button
              type="button"
              onClick={() => onAdd(entry)}
              title={`Put ${entry.title} back on the list`}
              className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
            >
              <span aria-hidden className="text-neutral-300 group-hover/pantry:text-indigo-500 dark:text-neutral-600">
                +
              </span>
              <span className="truncate text-sm text-neutral-700 dark:text-neutral-300">
                {entry.title}
              </span>
              <span className="ml-auto shrink-0 text-xs text-neutral-400">
                {[
                  entry.store,
                  cadenceLabel(entry),
                  lastBoughtLabel(entry.last_bought_at),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
            {/*
              Deleting is the only irreversible action on this screen, so it is
              the only control hidden until you point at its row.
            */}
            <button
              type="button"
              onClick={() => onForget(entry)}
              aria-label={`Never suggest ${entry.title} again`}
              title="Never suggest this again"
              className="shrink-0 rounded px-1 text-xs text-neutral-300 opacity-0 transition-opacity hover:text-red-500 focus:opacity-100 group-hover/pantry:opacity-100 dark:text-neutral-600"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ItemRow({
  item,
  onToggle,
  onOpen,
  onAisle,
  onStore,
  stores = [],
  memory,
}: {
  item: Task;
  onToggle: (t: Task) => void;
  /**
   * Open the item's editor. Absent outside `OpenTaskProvider`, and then the
   * title is plain text rather than a control that would do nothing.
   */
  onOpen?: (t: Task) => void;
  /** Absent in the cart, where an aisle no longer decides anything. */
  onAisle?: (t: Task, aisle: Aisle | null) => void;
  /** Absent in the cart, for the same reason. */
  onStore?: (t: Task, store: string | null) => void;
  /** Stores already on this list, offered as completions. */
  stores?: string[];
  /** So the select shows the aisle the row is actually filed under. */
  memory?: AisleMemory;
}) {
  const done = item.status === "done" || item.status === "cancelled";
  const aisle = itemAisle(item, memory);
  const store = storeHint(item);
  /*
    No `truncate`. An item name is short, so two lines is a sensible ceiling.
    A one-line ellipsis was hiding the end of anything longer than a word or
    two, inside a grid that had already halved the available width.
    `break-words` handles the one case wrapping cannot: a single long string
    with nowhere to break.
  */
  const titleClass = `block w-full break-words text-left text-sm ${
    done
      ? "text-neutral-400 line-through dark:text-neutral-600"
      : "text-neutral-900 dark:text-neutral-100"
  }`;
  // The store and the day as one muted line, the same shape `rowSubline` gives
  // a task row. Empty for most items, in which case nothing renders.
  const subline = itemSubline(item).join(" · ");
  return (
    /*
      `items-start`, not `items-center`. A row can now be two lines of title
      plus a subline, and a ring centred against that looks detached from the
      word it ticks off.
    */
    <li className="group/item flex items-start gap-3 border-b border-neutral-100 dark:border-neutral-800/70">
      {/*
        Ticking is the circle's job and only the circle's. The row's words are
        the door into the item, so the two cannot be one control: a click meant
        for "open this" that buys the milk instead is a mistake the user has to
        notice and undo, and on the surface they use fastest.

        The button is padded rather than sized, so the target is the full height
        of the row even though the ring inside it is 18px.
      */}
      <button
        type="button"
        onClick={() => onToggle(item)}
        aria-pressed={done}
        aria-label={`Mark ${item.title} as ${done ? "not bought" : "bought"}`}
        className="flex shrink-0 items-center py-2 pr-0.5"
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
      </button>

      <span className="flex min-w-0 flex-1 flex-col py-2">
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(item)}
            className={titleClass}
          >
            {item.title}
          </button>
        ) : (
          <span className={titleClass}>{item.title}</span>
        )}
        {subline && (
          <span className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {subline}
          </span>
        )}
      </span>

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
      {/*
        The store, as a text input backed by a <datalist>.

        Not a <select>, because the answer is "one of these or a new one" and a
        select cannot express the second half. That would make the composer the
        only place a store could be created, which is wrong for the row you are
        looking at when you realise the bread is better somewhere else. A
        datalist gives suggestions and keyboard support with no popover to build.

        Committed on blur and on Enter rather than per keystroke, since a store
        is free text and writing every keystroke would send "T", "Tr", "Tra" to
        the API on the way to "Target".
      */}
      {onStore && (
        <label className="shrink-0 self-center">
          <span className="sr-only">Store for {item.title}</span>
          <input
            type="text"
            list={`stores-${item.id}`}
            defaultValue={store ?? ""}
            placeholder="Store"
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = store ?? "";
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next === (store ?? "")) return;
              onStore(item, next || null);
            }}
            className="w-24 cursor-pointer rounded border-0 bg-transparent px-1 py-1 text-[11px] text-neutral-400 opacity-0 transition-opacity placeholder:text-neutral-400 focus:opacity-100 group-hover/item:opacity-100 dark:text-neutral-500"
          />
          <datalist id={`stores-${item.id}`}>
            {stores.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
      )}

      {onAisle && (
        <label className="shrink-0 self-center">
          <span className="sr-only">Aisle for {item.title}</span>
          <select
            value={aisle ?? ""}
            onChange={(e) =>
              onAisle(item, e.target.value ? (e.target.value as Aisle) : null)
            }
            className="cursor-pointer rounded border-0 bg-transparent py-1 pl-1 pr-4 text-[11px] text-neutral-400 opacity-0 transition-opacity focus:opacity-100 group-hover/item:opacity-100 dark:text-neutral-500"
          >
            {/*
              "Automatic", not "Other": clearing a correction hands the word
              back to the lexicon, which will usually have an opinion — so the
              row does not land in the Other group, so a label saying it would
              misdescribe what the control does.
            */}
            <option value="">Automatic</option>
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
