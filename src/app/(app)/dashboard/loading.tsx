const bar = 'animate-pulse rounded bg-slate-200 dark:bg-slate-700';

export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:space-y-6 sm:p-6 lg:p-8" aria-busy="true" aria-label="Loading dashboard">
      <div>
        <div className={`${bar} mb-2 h-8 w-48 rounded-lg`} />
        <div className={`${bar} h-4 w-64`} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 sm:p-5">
            <div className={`${bar} mb-3 h-4 w-24`} />
            <div className={`${bar} h-8 w-16`} />
          </div>
        ))}
      </div>
      <div className="grid gap-5 sm:gap-6 lg:grid-cols-3">
        <div className="space-y-5 sm:space-y-6 lg:col-span-2">
          <div className="h-48 animate-pulse rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900" />
          <div className="h-56 animate-pulse rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900" />
        </div>
        <div className="space-y-5 sm:space-y-6">
          <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900" />
          <div className="h-56 animate-pulse rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900" />
        </div>
      </div>
    </div>
  );
}
