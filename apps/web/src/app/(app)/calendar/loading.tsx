import { PageSkeleton, SkeletonBar } from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="Calendar" maxWidth="max-w-7xl">
      {/* Week nav, then the seven day columns. */}
      <SkeletonBar className="mb-4 h-9 w-64 rounded-lg" />
      <div className="animate-pulse grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="space-y-2">
            <SkeletonBar className="h-4 w-full" />
            <SkeletonBar className="h-40 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
