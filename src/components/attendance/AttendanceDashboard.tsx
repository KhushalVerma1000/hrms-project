'use client';

import { useState, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Calendar, Clock, Users, RefreshCw, ArrowUp, ArrowDown, Minus, Filter } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface DaySummary {
  employeeCode: string;
  employeeName: string;
  date: string;
  firstIn: Date | null;
  lastOut: Date | null;
  totalPunches: number;
  totalHoursMinutes: string;
}

interface Store {
  id: string;
  name: string;
  client: { shortName: string };
}

interface Props {
  summaries: DaySummary[];
  stores: Store[];
  fromDate: string;
  toDate: string;
  selectedStoreId?: string;
  selectedDirection?: string;
  timezone: string;
}

function formatTime(date: Date | null, timezone: string): string {
  if (!date) return '—';
  return new Date(date).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
    hour12: true,
  });
}

export function AttendanceDashboard({
  summaries,
  stores,
  fromDate,
  toDate,
  selectedStoreId,
  selectedDirection,
  timezone,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [showFilters, setShowFilters] = useState(false);

  function updateFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  // Poll sync status
  const { data: syncStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn: async () => {
      const res = await fetch('/api/sync/status');
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const lateArrivalCount = summaries.filter((s) => {
    if (!s.firstIn) return false;
    const time = new Date(s.firstIn);
    const hours = time.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
    return parseInt(hours) >= 10; // After 10am considered late (adjust as needed)
  }).length;

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Attendance</h1>
          <p className="text-sm text-slate-500 mt-1">
            Timezone: <span className="font-mono">{timezone}</span>
            {syncStatus?.lastSync && (
              <> · Last synced: {new Date(syncStatus.lastSync).toLocaleTimeString('en-IN')}</>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <Filter className="w-4 h-4" />
          Filters
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Users className="w-5 h-5" />} label="Employees" value={new Set(summaries.map((s) => s.employeeCode)).size} color="blue" />
        <StatCard icon={<Calendar className="w-5 h-5" />} label="Total Records" value={summaries.length} color="slate" />
        <StatCard icon={<Clock className="w-5 h-5" />} label="Late Arrivals" value={lateArrivalCount} color="amber" />
        <StatCard icon={<RefreshCw className="w-5 h-5" />} label="Sync Status" value={syncStatus?.pendingCommands ?? 0} color={syncStatus?.pendingCommands > 0 ? 'amber' : 'green'} label2="pending" />
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => updateFilter('from', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => updateFilter('to', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
            />
          </div>
          {stores.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Store</label>
              <select
                value={selectedStoreId ?? ''}
                onChange={(e) => updateFilter('storeId', e.target.value || undefined)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
              >
                <option value="">All stores</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.client.shortName} — {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Punch Direction</label>
            <select
              value={selectedDirection ?? ''}
              onChange={(e) => updateFilter('direction', e.target.value || undefined)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
            >
              <option value="">All</option>
              <option value="IN">In</option>
              <option value="OUT">Out</option>
            </select>
          </div>
        </div>
      )}

      {/* Attendance Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                <th className="px-4 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Employee</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Code</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wide">First In</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Last Out</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Total Time</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wide">Punches</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {summaries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    No attendance records found for the selected filters.
                  </td>
                </tr>
              ) : (
                summaries.map((s) => (
                  <tr
                    key={`${s.employeeCode}|${s.date}`}
                    className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300 font-mono text-xs">
                      {new Date(s.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-900 dark:text-white">{s.employeeName}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{s.employeeCode}</td>
                    <td className="px-4 py-3">
                      {s.firstIn ? (
                        <div className="flex items-center gap-1.5">
                          <ArrowUp className="w-3 h-3 text-emerald-500" />
                          <span className="text-slate-700 dark:text-slate-300">{formatTime(s.firstIn, timezone)}</span>
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {s.lastOut && s.lastOut !== s.firstIn ? (
                        <div className="flex items-center gap-1.5">
                          <ArrowDown className="w-3 h-3 text-blue-500" />
                          <span className="text-slate-700 dark:text-slate-300">{formatTime(s.lastOut, timezone)}</span>
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${
                        s.totalHoursMinutes === '—'
                          ? 'text-slate-400'
                          : 'text-slate-900 dark:text-white'
                      }`}>
                        {s.totalHoursMinutes}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300">
                        {s.totalPunches}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  label2,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  label2?: string;
  value: number;
  color: 'blue' | 'slate' | 'amber' | 'green';
}) {
  const colors = {
    blue: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30',
    slate: 'text-slate-600 bg-slate-50 dark:bg-slate-800',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30',
    green: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
  };
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <div className={`inline-flex p-2 rounded-lg ${colors[color]} mb-3`}>{icon}</div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white">{value.toLocaleString()}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}{label2 ? ` ${label2}` : ''}</p>
    </div>
  );
}
