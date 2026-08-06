import { PageSkeleton, SkeletonList } from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="All tasks">
      <SkeletonList rows={8} />
    </PageSkeleton>
  );
}
