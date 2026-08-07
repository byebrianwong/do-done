import { PageSkeleton, SkeletonTaskRows } from "@/components/page-skeleton";

export default function Loading() {
  // No title: the task's own row is the heading here.
  return (
    <PageSkeleton>
      <SkeletonTaskRows rows={3} />
    </PageSkeleton>
  );
}
