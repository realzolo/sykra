export default function ReportDetailLoading() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border bg-background shrink-0 flex items-center gap-3">
        <div className="h-4 w-20 rounded bg-muted animate-pulse" />
        <div className="h-4 w-4 rounded bg-muted animate-pulse" />
        <div className="h-5 w-48 rounded bg-muted animate-pulse" />
        <div className="h-5 w-16 rounded-full bg-muted animate-pulse ml-auto" />
      </div>
      <div className="px-6 py-3 border-b border-border bg-background shrink-0 flex gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="mx-6 my-3 rounded-lg border border-border p-4 space-y-2">
            <div className="flex gap-2">
              <div className="h-5 w-16 rounded-full bg-muted animate-pulse" />
              <div className="h-5 w-20 rounded-full bg-muted animate-pulse" />
            </div>
            <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
            <div className="h-3 w-full rounded bg-muted animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
