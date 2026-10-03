import { Skeleton } from '@/components/ui/primitives';

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading command center">
      <Skeleton className="h-16 w-80" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(290px,350px)]">
        <Skeleton className="h-[62vh] min-h-[380px]" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}
