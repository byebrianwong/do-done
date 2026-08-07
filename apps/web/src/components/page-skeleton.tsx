/**
 * Placeholders for the `loading.tsx` of every `(app)` route.
 *
 * Why these exist at all: the routes are dynamic server components (auth comes
 * from cookies, the rows from Supabase), so without a `loading.tsx` Next.js
 * skips prefetching them *and* blocks the whole client-side transition until the
 * server render lands. A sidebar click changed nothing on screen — not even the
 * active pill, since `usePathname()` only updates once the navigation commits —
 * for as long as the query took. The fallback is what lets the transition commit
 * immediately; these components are what it commits to.
 *
 * They are therefore built to be *recognised*, not admired:
 *
 * - The heading is the real title in the real type, so the destination is
 *   readable on the first frame and doesn't reflow when the rows arrive.
 * - The rows carry the geometry of a real task row (`px-3 py-2.5 gap-3`, a
 *   20px circle), so the swap is a fill-in rather than a jump.
 * - `dd-skeleton` (globals.css) holds everything invisible for ~140ms, so a
 *   navigation that beats the delay never shows a placeholder at all.
 */

/** One grey bar. Width/height come from the caller so rows can vary. */
export function SkeletonBar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded bg-neutral-200 dark:bg-neutral-800 ${className}`}
      aria-hidden
    />
  );
}

/**
 * A stand-in task row. Widths step down the list so it reads as a set of
 * different tasks rather than a striped block.
 */
function SkeletonTaskRow({ titleWidth }: { titleWidth: string }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <div className="flex h-5 shrink-0 items-center">
        <SkeletonBar className="h-[18px] w-[18px] rounded-full" />
      </div>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <SkeletonBar className={`h-3.5 ${titleWidth}`} />
        <SkeletonBar className="h-2.5 w-24" />
      </div>
    </div>
  );
}

const ROW_WIDTHS = [
  "w-3/5",
  "w-4/5",
  "w-2/5",
  "w-3/4",
  "w-1/2",
  "w-2/3",
  "w-[70%]",
  "w-1/3",
];

/** A run of task rows, cycling through `ROW_WIDTHS` so no two neighbours match. */
export function SkeletonTaskRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonTaskRow key={i} titleWidth={ROW_WIDTHS[i % ROW_WIDTHS.length]} />
      ))}
    </div>
  );
}

/**
 * The frame every list route's fallback shares: the page container, the real
 * `<h1>`, and the delayed fade.
 *
 * `aria-busy` + the polite live region are how this reaches a screen reader —
 * the visual skeleton says nothing on its own, and the announcement of the new
 * page would otherwise not arrive until the rows did.
 */
export function PageSkeleton({
  title,
  /** Must match the real page's container, or the swap shifts sideways. */
  maxWidth = "max-w-3xl",
  children,
}: {
  /**
   * Omitted on the detail routes: `/projects/[id]` and `/task/[id]` are named
   * by data we don't have yet, so they get a bar the same height as the
   * heading rather than a guess.
   */
  title?: string;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`dd-skeleton mx-auto ${maxWidth}`}
      aria-busy="true"
      aria-live="polite"
    >
      {title ? (
        <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {title}
        </h1>
      ) : (
        <SkeletonBar className="mb-6 h-8 w-56 animate-pulse" />
      )}
      {children}
      <span className="sr-only">{title ? `Loading ${title}` : "Loading"}</span>
    </div>
  );
}

/** The default body: a quick-add bar's worth of space, then rows. */
export function SkeletonList({
  rows = 5,
  quickAdd = true,
}: {
  rows?: number;
  quickAdd?: boolean;
}) {
  return (
    <>
      {quickAdd ? (
        <SkeletonBar className="mb-4 h-11 w-full rounded-xl" />
      ) : null}
      <SkeletonTaskRows rows={rows} />
    </>
  );
}
