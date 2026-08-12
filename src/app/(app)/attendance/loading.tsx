export default function AttendanceLoading() {
  return (
    <div className="p-6 lg:p-8">
      <div className="h-8 w-40 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-64 bg-slate-200 dark:bg-slate-700 rounded animate-pulse mb-6" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 animate-pulse mb-3" />
            <div className="h-7 w-12 bg-slate-200 dark:bg-slate-700 rounded animate-pulse mb-1" />
            <div className="h-3 w-20 bg-slate-100 dark:bg-slate-600 rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex gap-4 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
            <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
