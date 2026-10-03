import { Skeleton } from '@/components/ui/primitives';

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading stations">
      <Skeleton className="h-16 w-96" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-[420px]" />
        <Skeleton className="h-[420px]" />
      </div>
    </div>
  );
}
