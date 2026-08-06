import { PageSkeleton, SkeletonList } from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="Completed">
      {/* No quick-add on Completed. */}
      <SkeletonList rows={6} quickAdd={false} />
    </PageSkeleton>
  );
}
