import {
  PageSkeleton,
  SkeletonBar,
  SkeletonTaskRows,
} from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="Today">
      {/* Today leads with the schedule card, then the quick-add bar. */}
      <SkeletonBar className="mb-4 h-20 w-full rounded-xl" />
      <SkeletonBar className="mb-4 h-11 w-full rounded-xl" />
      <SkeletonTaskRows rows={6} />
    </PageSkeleton>
  );
}
