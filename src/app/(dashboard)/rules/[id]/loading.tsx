export default function RuleSetDetailLoading() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border bg-background shrink-0 flex items-center gap-3">
        <div className="h-4 w-20 rounded bg-muted animate-pulse" />
        <div className="h-4 w-4 rounded bg-muted animate-pulse" />
        <div className="h-5 w-40 rounded bg-muted animate-pulse" />
        <div className="h-8 w-20 rounded-md bg-muted animate-pulse ml-auto" />
      </div>
      <div className="flex-1 overflow-auto p-6 space-y-4">
        <div className="h-24 rounded-lg bg-muted animate-pulse" />
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border p-4 space-y-2">
            <div className="h-4 w-48 rounded bg-muted animate-pulse" />
            <div className="h-3 w-full rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
