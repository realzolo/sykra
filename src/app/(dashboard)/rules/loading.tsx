export default function RulesLoading() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border bg-background shrink-0 flex items-center justify-between">
        <div className="h-7 w-24 rounded-md bg-muted animate-pulse" />
        <div className="h-9 w-32 rounded-md bg-muted animate-pulse" />
      </div>
      <div className="flex-1 overflow-auto">
        <div className="flex items-center px-4 py-2 border-b border-border bg-muted/40 gap-4">
          <div className="h-3 w-24 rounded bg-muted animate-pulse" />
          <div className="h-3 w-16 rounded bg-muted animate-pulse ml-auto" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center px-4 py-4 border-b border-border gap-4">
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-40 rounded bg-muted animate-pulse" />
              <div className="h-3 w-64 rounded bg-muted animate-pulse" />
            </div>
            <div className="h-4 w-12 rounded bg-muted animate-pulse" />
            <div className="h-8 w-8 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
