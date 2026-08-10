import { PageSkeleton, SkeletonBar } from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="Tags">
      {/* Tags is a card grid, like Projects — not a task list. */}
      <div className="animate-pulse grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonBar key={i} className="h-[86px] w-full rounded-xl" />
        ))}
      </div>
    </PageSkeleton>
  );
}
