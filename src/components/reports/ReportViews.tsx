import { Download, FileSpreadsheet } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyNote } from '@/components/dashboard/widgets';
import { monthLabel } from '@/lib/reports/period';
import { STATUS_LABEL, type DayRecord, type DayStatus, type GroupRow } from '@/lib/reports/types';
import type { TrendPoint } from '@/lib/reports/aggregate';
import { NOTE_LABEL } from '@/lib/reports/rules';

const STATUS_STYLE: Record<DayStatus, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  HALF_DAY: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  ABSENT: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  ON_LEAVE: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  WEEK_OFF: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  HOLIDAY: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  NO_PUNCH: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  NOT_RECORDED: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

export function StatusPill({ status }: { status: DayStatus }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

const pctTone = (p: number | null) =>
  p === null ? 'bg-slate-300' : p >= 90 ? 'bg-emerald-500' : p >= 75 ? 'bg-amber-500' : 'bg-red-500';

function PctBar({ pct }: { pct: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
        <div className={`h-full ${pctTone(pct)}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className="tabular-nums">{pct === null ? '—' : `${pct}%`}</span>
    </div>
  );
}

// ─── Downloads ──────────────────────────────────────────────────────────────

export interface DownloadOption { kind: string; label: string; description: string; disabledReason?: string }

export function DownloadPanel({ options, query }: { options: DownloadOption[]; query: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((o) => {
        const body = (
          <>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {o.disabledReason ? <FileSpreadsheet className="h-4 w-4" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{o.label} <span className="font-normal text-muted-foreground">· CSV</span></span>
              <span className="block text-xs text-muted-foreground">{o.disabledReason ?? o.description}</span>
            </span>
          </>
        );
        const cls = 'flex items-start gap-3 rounded-lg border p-3 text-left';
        return o.disabledReason ? (
          <div key={o.kind} className={`${cls} opacity-60`} aria-disabled="true">{body}</div>
        ) : (
          // Plain <a>: this is a file download, not a page navigation.
          <a key={o.kind} href={`/reports/download?report=${o.kind}&${query}`} className={`${cls} transition-colors hover:border-primary/50 hover:bg-slate-50 dark:hover:bg-slate-800`}>
            {body}
          </a>
        );
      })}
    </div>
  );
}

// ─── Trend chart ────────────────────────────────────────────────────────────

export function TrendChart({ points, bucket }: { points: TrendPoint[]; bucket: 'day' | 'month' }) {
  if (points.length === 0) return <EmptyNote>No attendance in this period yet.</EmptyNote>;
  const every = points.length > 16 ? 5 : 1; // label every Nth bar so day labels don't collide
  return (
    <div>
      <div className="flex h-36 items-end gap-0.5 sm:gap-1" role="img" aria-label={`Attendance percentage by ${bucket}`}>
        {points.map((p) => (
          <div key={p.key} className="flex h-full flex-1 flex-col justify-end" title={`${bucket === 'month' ? monthLabel(p.key) : p.key}: ${p.pct ?? '—'}% (${p.worked} of ${p.scheduled})`}>
            <div className={`w-full rounded-t ${pctTone(p.pct)}`} style={{ height: `${Math.max(p.pct ?? 0, p.pct ? 3 : 1)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-0.5 sm:gap-1">
        {points.map((p, i) => (
          <span key={p.key} className="flex-1 text-center text-[10px] text-muted-foreground">
            {i % every === 0 ? (bucket === 'month' ? monthLabel(p.key).slice(0, 3) : p.key.slice(8)) : ''}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Bar height = attendance %. Green ≥ 90%, amber ≥ 75%, red below.</p>
    </div>
  );
}

// ─── Breakdown table ────────────────────────────────────────────────────────

export function BreakdownTable({ rows, nameHeader, limit = 50 }: { rows: GroupRow[]; nameHeader: string; limit?: number }) {
  if (rows.length === 0) return <EmptyNote>Nothing to show for these filters.</EmptyNote>;
  const shown = rows.slice(0, limit);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{nameHeader}</TableHead>
            <TableHead className="text-right">People</TableHead>
            <TableHead className="text-right">Present</TableHead>
            <TableHead className="text-right">Absent*</TableHead>
            <TableHead className="text-right">Leave</TableHead>
            <TableHead>Attendance</TableHead>
            <TableHead className="text-right">OT hrs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => (
            <TableRow key={r.key}>
              <TableCell>
                <div className="font-medium">{r.label}</div>
                {r.sub && <div className="text-xs text-muted-foreground">{r.sub}</div>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.employees}</TableCell>
              <TableCell className="text-right tabular-nums">{r.present + r.halfDay * 0.5}</TableCell>
              <TableCell className="text-right tabular-nums">{r.absent + r.noPunch}</TableCell>
              <TableCell className="text-right tabular-nums">{r.onLeave}</TableCell>
              <TableCell><PctBar pct={r.attendancePct} /></TableCell>
              <TableCell className="text-right tabular-nums">{r.otHours || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > limit && (
        <p className="px-2 pt-2 text-xs text-muted-foreground">Showing {limit} of {rows.length}. Download the summary for the full list.</p>
      )}
    </div>
  );
}

// ─── Daily records ──────────────────────────────────────────────────────────

export function RecordsTable({ rows, total, limit }: { rows: DayRecord[]; total: number; limit: number }) {
  if (rows.length === 0) return <EmptyNote>No daily records match these filters.</EmptyNote>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Person</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>In</TableHead>
            <TableHead>Out</TableHead>
            <TableHead className="text-right">Hours</TableHead>
            <TableHead className="text-right">OT</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.employeeId}|${r.date}`}>
              <TableCell className="whitespace-nowrap tabular-nums">{r.date}</TableCell>
              <TableCell>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.staffCode}</div>
              </TableCell>
              <TableCell className="text-sm">{r.storeName}</TableCell>
              <TableCell><StatusPill status={r.status} /></TableCell>
              <TableCell className="tabular-nums">{r.checkIn ?? '—'}</TableCell>
              <TableCell className="tabular-nums">{r.checkOut ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.hours ?? '—'}
                {r.notes.length > 0 && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400" title={r.notes.map((n) => NOTE_LABEL[n]).join('; ')}>auto</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.otHours || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {total > limit && (
        <p className="px-2 pt-2 text-xs text-muted-foreground">
          Showing the latest {limit} of {total.toLocaleString('en-IN')} records. Use the download for the complete list.
        </p>
      )}
    </div>
  );
}
