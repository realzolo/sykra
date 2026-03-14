export default function DashboardLoading() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border bg-background shrink-0">
        <div className="h-7 w-40 rounded-md bg-muted animate-pulse" />
      </div>
      <div className="px-6 py-3 border-b border-border bg-background shrink-0 flex gap-2">
        <div className="h-8 w-32 rounded-md bg-muted animate-pulse" />
        <div className="h-8 w-24 rounded-md bg-muted animate-pulse" />
      </div>
      <div className="flex-1 overflow-auto">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center px-4 py-3 border-b border-border gap-4">
            <div className="h-4 w-48 rounded bg-muted animate-pulse" />
            <div className="h-4 w-32 rounded bg-muted animate-pulse" />
            <div className="h-4 w-20 rounded bg-muted animate-pulse ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
