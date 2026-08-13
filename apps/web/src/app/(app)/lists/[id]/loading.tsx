import { PageSkeleton, SkeletonBar } from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="List">
      <div className="animate-pulse flex flex-col gap-4">
        {/* The composer, then two columns of short item rows. */}
        <SkeletonBar className="h-[38px] w-full rounded-lg" />
        <div className="grid gap-x-8 sm:grid-cols-2">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonBar key={i} className="my-2 h-[20px] w-full rounded" />
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
