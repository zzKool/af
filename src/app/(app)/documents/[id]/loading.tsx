export default function DocumentDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 h-6 w-48 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Left pane — preview skeleton */}
        <div className="aspect-[3/4] animate-pulse rounded-lg bg-muted" />
        {/* Right pane — form skeleton */}
        <div className="space-y-4">
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
          <div className="h-10 w-full animate-pulse rounded bg-muted" />
          <div className="h-10 w-full animate-pulse rounded bg-muted" />
          <div className="h-10 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-10 w-full animate-pulse rounded bg-muted" />
          <div className="h-10 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-10 w-full animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
