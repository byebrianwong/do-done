import { PageSkeleton, SkeletonBar } from "@/components/page-skeleton";
import { ALL_SHOPPING_NAME } from "@do-done/shared";

export default function Loading() {
  return (
    <PageSkeleton title={ALL_SHOPPING_NAME}>
      <div className="animate-pulse flex flex-col gap-4">
        {/* The list pills, the composer, then two columns of item rows. */}
        <SkeletonBar className="h-[26px] w-1/2 rounded-full" />
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
