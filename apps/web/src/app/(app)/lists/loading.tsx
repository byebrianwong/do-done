import { PageSkeleton, SkeletonBar } from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="Lists">
      {/* Same card grid as Projects, so the swap is a fill-in not a jump. */}
      <div className="animate-pulse grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonBar key={i} className="h-[86px] w-full rounded-xl" />
        ))}
      </div>
    </PageSkeleton>
  );
}
