import {
  PageSkeleton,
  SkeletonBar,
  SkeletonTaskRows,
} from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="Upcoming">
      <SkeletonBar className="mb-4 h-11 w-full rounded-xl" />
      {/* Upcoming is grouped by day, so the placeholder is too — a flat run of
          rows would restructure itself when the real groups land. */}
      <div className="animate-pulse space-y-5">
        {[3, 2, 4].map((rows, i) => (
          <div key={i}>
            <SkeletonBar className="mb-2 ml-3 h-3 w-28" />
            <SkeletonTaskRows rows={rows} />
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
