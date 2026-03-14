export default function ProjectDetailLoading() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border bg-background shrink-0 flex items-center gap-3">
        <div className="h-4 w-20 rounded bg-muted animate-pulse" />
        <div className="h-4 w-4 rounded bg-muted animate-pulse" />
        <div className="h-5 w-36 rounded bg-muted animate-pulse" />
      </div>
      <div className="px-6 py-3 border-b border-border bg-background shrink-0 flex gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 w-24 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
      <div className="flex-1 overflow-auto p-6 space-y-4">
        <div className="h-32 rounded-lg bg-muted animate-pulse" />
        <div className="h-64 rounded-lg bg-muted animate-pulse" />
      </div>
    </div>
  );
}
