import { PageSkeleton, SkeletonList } from "@/components/page-skeleton";

export default function Loading() {
  // The tag itself isn't knowable here — a loading.tsx takes no params — so
  // the heading carries the surface rather than the specific tag.
  return (
    <PageSkeleton title="Tag">
      <SkeletonList rows={6} />
    </PageSkeleton>
  );
}
