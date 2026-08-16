import { PageSkeleton, SkeletonBar } from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="Places">
      <div className="animate-pulse space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonBar key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    </PageSkeleton>
  );
}
