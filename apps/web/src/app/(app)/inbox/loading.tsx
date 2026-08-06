import { PageSkeleton, SkeletonList } from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="Inbox">
      <SkeletonList rows={5} />
    </PageSkeleton>
  );
}
