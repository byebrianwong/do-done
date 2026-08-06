import { PageSkeleton, SkeletonList } from "@/components/page-skeleton";

export default function Loading() {
  // No title: the project's name is the heading, and it arrives with the data.
  return (
    <PageSkeleton>
      <SkeletonList rows={6} />
    </PageSkeleton>
  );
}
