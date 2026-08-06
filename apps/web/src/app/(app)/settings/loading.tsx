import { PageSkeleton, SkeletonBar } from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="Settings">
      <div className="animate-pulse space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonBar key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    </PageSkeleton>
  );
}
