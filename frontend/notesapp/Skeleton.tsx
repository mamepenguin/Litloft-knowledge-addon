export function SkeletonRows({ count, rowClass }: { count: number; rowClass: string }) {
  return (
    <div aria-hidden="true" data-testid="skeleton" className="flex flex-col gap-1">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`animate-pulse rounded-xl bg-bg-elevated ${rowClass}`} />
      ))}
    </div>
  );
}

export function SkeletonCards({ count }: { count: number }) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton"
      className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] sm:gap-5"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-[196px] animate-pulse rounded-2xl bg-bg-elevated" />
      ))}
    </div>
  );
}
