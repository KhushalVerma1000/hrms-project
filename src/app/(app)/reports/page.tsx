import { redirect } from 'next/navigation';
import { CalendarCheck, CalendarOff, Clock, Percent, UserX, Users, FileWarning, Timer } from 'lucide-react';
import { auth } from '@/auth';
import { can } from '@/lib/auth/can';
import { Designation } from '@prisma/client';
import { Card, CardContent } from '@/components/ui/card';
import { KpiCard, KpiGrid, PageHeader, Section, SegmentedBar, EmptyNote, type Tone } from '@/components/dashboard/widgets';
import { ReportFilters, type FilterValues } from '@/components/reports/ReportFilters';
import { BreakdownTable, DownloadPanel, RecordsTable, TrendChart, type DownloadOption } from '@/components/reports/ReportViews';
import { loadReport, ReportTooLargeError, todayKey, type ReportData } from '@/lib/reports/data';
import { filtersToQuery, parseFilters, REPORT_KINDS } from '@/lib/reports/filters';
import { groupRows, totalsOf, trend } from '@/lib/reports/aggregate';
import { REPORT_META, musterAvailable } from '@/lib/reports/export';
import { diffDays, fyStartYearOf } from '@/lib/reports/period';
import { STANDARD_SHIFT_HOURS } from '@/lib/config';
import { DAY_STATUSES, STATUS_LABEL } from '@/lib/reports/types';

export const metadata = { title: 'Reports | HRMS Platform' };
export const dynamic = 'force-dynamic';

const RECORD_LIMIT = 100;

const roleBlurb = {
  ADMIN: 'All clients and stores',
  CLIENT: 'All stores of your company',
  MANAGER: 'Your store',
} as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session, 'reports:view', {})) redirect('/dashboard');

  const sp = await searchParams;
  const today = todayKey();
  const filters = parseFilters((k) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; }, today);

  let data: ReportData | null = null;
  let tooLarge: string | null = null;
  try {
    data = await loadReport(session, filters, today);
  } catch (err) {
    if (err instanceof ReportTooLargeError) tooLarge = err.message;
    else throw err;
  }

  // Filter-form options come from the user's own scope, so they can never see other stores' names.
  const scopeStores = data?.scopeStores ?? [];
  const clients = [...new Map(scopeStores.map((s) => [s.clientId, { id: s.clientId, name: s.clientName }])).values()];
  const thisFy = fyStartYearOf(today);
  const yearOptions = [thisFy + 1, thisFy, thisFy - 1, thisFy - 2];
  const query = filtersToQuery(filters).toString();

  const formValues: FilterValues = {
    period: filters.period.type, basis: filters.period.basis, year: filters.period.year,
    month: filters.period.month, quarter: filters.period.quarter,
    from: filters.period.from ?? '', to: filters.period.to ?? '',
    clientId: filters.clientId ?? '', storeId: filters.storeId ?? '', mode: filters.mode ?? '',
    designation: filters.designation ?? '', status: filters.status ?? '', q: filters.q ?? '',
  };
  const form = (
    <ReportFilters
      values={formValues}
      clients={clients}
      stores={scopeStores}
      designations={Object.values(Designation).map((d) => ({ value: d, label: d.replace(/_/g, ' ').toLowerCase().replace(/^\w|\s\w/g, (c) => c.toUpperCase()) }))}
      statuses={DAY_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
      yearOptions={[...new Set([...yearOptions, filters.period.year])].sort((a, b) => b - a)}
    />
  );
  const header = (
    <PageHeader
      title="Reports & Analytics"
      subtitle={`Monthly, quarterly and yearly attendance — ${roleBlurb[session.user.role as keyof typeof roleBlurb] ?? 'your scope'}`}
      dateLabel={data ? data.period.label : ''}
    />
  );

  if (tooLarge || !data) {
    return (
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        {header}
        {form}
        <Card><CardContent className="p-5 text-sm text-amber-800 dark:text-amber-300">{tooLarge}</CardContent></Card>
      </div>
    );
  }

  const { records, monthlyOt, period, effectiveTo } = data;
  const totals = totalsOf(records, monthlyOt);
  const bucket = diffDays(period.from, period.to) + 1 <= 31 ? 'day' : 'month';
  const shownRecords = filters.status ? records.filter((r) => r.status === filters.status) : records;
  const latest = [...shownRecords].reverse().slice(0, RECORD_LIMIT);

  const attTone: Tone = totals.attendancePct === null ? 'default' : totals.attendancePct >= 90 ? 'good' : totals.attendancePct >= 75 ? 'warning' : 'danger';
  const byEmployee = groupRows(records, monthlyOt, 'employee');
  const byStore = groupRows(records, monthlyOt, 'store');
  const byClient = groupRows(records, monthlyOt, 'client');
  const byDesignation = groupRows(records, monthlyOt, 'designation');
  const topAbsent = [...byEmployee].filter((r) => r.absent + r.noPunch > 0).sort((a, b) => b.absent + b.noPunch - (a.absent + a.noPunch)).slice(0, 5);
  const topOt = [...byEmployee].filter((r) => r.otHours > 0).sort((a, b) => b.otHours - a.otHours).slice(0, 5);

  const downloads: DownloadOption[] = REPORT_KINDS.map((k) => ({
    kind: k,
    ...REPORT_META[k],
    disabledReason: k === 'muster' && !musterAvailable(period) ? 'Only for periods of 31 days or less — choose a single month or a shorter range.' : undefined,
  }));

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      {header}
      {form}

      {records.length === 0 ? (
        <Card><CardContent className="p-2"><EmptyNote>
          {scopeStores.length === 0
            ? 'No stores are available to report on for your account.'
            : period.from > today
              ? 'This period is in the future — there is no attendance yet.'
              : 'No attendance found for these filters. Try a wider period or clear a filter.'}
        </EmptyNote></CardContent></Card>
      ) : (
        <>
          {effectiveTo < period.to && (
            <p className="text-xs text-muted-foreground">This period is still running — figures cover {period.from} to {effectiveTo}.</p>
          )}

          <KpiGrid>
            <KpiCard label="Attendance rate" value={totals.attendancePct === null ? '—' : `${totals.attendancePct}%`} icon={Percent} tone={attTone}
              hint={`${totals.daysWorked} of ${totals.scheduledDays} scheduled days`} />
            <KpiCard label="People" value={totals.employees} icon={Users} />
            <KpiCard label="Absent / no-punch days" value={totals.absent + totals.noPunch} icon={UserX} tone={totals.absent + totals.noPunch > 0 ? 'warning' : 'good'} />
            <KpiCard label="Overtime hours" value={totals.otHours} icon={Timer}
              hint={totals.otHours > 0 ? `Payroll monthly ${totals.otPayroll} h · manager-entered daily ${totals.otDaily} h` : 'None recorded'} />
          </KpiGrid>
          {totals.autoClosed > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {totals.autoClosed} shift{totals.autoClosed === 1 ? '' : 's'} had no check-out and {totals.autoClosed === 1 ? 'was' : 'were'} counted as {STANDARD_SHIFT_HOURS}-hour shifts. Look for “auto” in the daily records, or the Remarks column in the download.
            </p>
          )}
          <KpiGrid>
            <KpiCard label="Days present" value={totals.present} icon={CalendarCheck} />
            <KpiCard label="Half days" value={totals.halfDay} icon={Clock} />
            <KpiCard label="Leave / week-off / holiday" value={totals.onLeave + totals.weekOff + totals.holiday} icon={CalendarOff} />
            <KpiCard label="Not recorded" value={totals.notRecorded} icon={FileWarning} tone={totals.notRecorded > 0 ? 'warning' : 'default'}
              hint={totals.notRecorded > 0 ? 'Manual-store days nobody has entered' : undefined} />
          </KpiGrid>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={bucket === 'day' ? 'Attendance by day' : 'Attendance by month'}>
              <TrendChart points={trend(records, bucket)} bucket={bucket} />
            </Section>
            <Section title="Status mix">
              <SegmentedBar
                total={records.length}
                segments={[
                  { label: 'Present', value: totals.present, color: 'bg-emerald-500' },
                  { label: 'Half day', value: totals.halfDay, color: 'bg-amber-400' },
                  { label: 'Absent', value: totals.absent, color: 'bg-red-500' },
                  { label: 'No punch', value: totals.noPunch, color: 'bg-orange-400' },
                  { label: 'On leave', value: totals.onLeave, color: 'bg-blue-500' },
                  { label: 'Week off / holiday', value: totals.weekOff + totals.holiday, color: 'bg-violet-400' },
                  { label: 'Not recorded', value: totals.notRecorded, color: 'bg-slate-300' },
                ]}
              />
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Most absences">
              {topAbsent.length === 0 ? <EmptyNote>No absences in this period.</EmptyNote> : (
                <ul className="divide-y text-sm">
                  {topAbsent.map((r) => (
                    <li key={r.key} className="flex items-center justify-between py-2">
                      <span><span className="font-medium">{r.label}</span> <span className="text-xs text-muted-foreground">{r.sub}</span></span>
                      <span className="tabular-nums font-semibold">{r.absent + r.noPunch} days</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Most overtime">
              {topOt.length === 0 ? <EmptyNote>No overtime in this period.</EmptyNote> : (
                <ul className="divide-y text-sm">
                  {topOt.map((r) => (
                    <li key={r.key} className="flex items-center justify-between py-2">
                      <span><span className="font-medium">{r.label}</span> <span className="text-xs text-muted-foreground">{r.sub}</span></span>
                      <span className="tabular-nums font-semibold">{r.otHours} hrs</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          {/* Breakdowns: the levels above your own scope aren't shown (a Manager has one store, a Client one company). */}
          {clients.length > 1 && <Section title="By client"><BreakdownTable rows={byClient} nameHeader="Client" /></Section>}
          {byStore.length > 1 && <Section title="By store"><BreakdownTable rows={byStore} nameHeader="Store" /></Section>}
          <Section title="By designation"><BreakdownTable rows={byDesignation} nameHeader="Designation" /></Section>
          <Section title="By employee"><BreakdownTable rows={byEmployee} nameHeader="Employee" limit={50} /></Section>
          <p className="text-xs text-muted-foreground">
            * Absent includes biometric “no punch” days (the store was open but the person never scanned — this can be a week-off or leave).
            Attendance rate = days worked ÷ scheduled days, excluding week-offs, holidays and not-recorded days.
            Biometric shifts (including overnight ones) count on the day they started. Overtime is only what was recorded (payroll monthly totals, or the daily OT managers entered) — never estimated from punches. Anyone who checked in without checking out is counted as a {STANDARD_SHIFT_HOURS}-hour shift.
          </p>
        </>
      )}

      <Section title="Download reports">
        <p className="mb-3 text-sm text-muted-foreground">Files use the filters above and open in Excel or Google Sheets. Every download is recorded in the audit log.</p>
        <DownloadPanel options={downloads} query={query} />
      </Section>

      {records.length > 0 && (
        <Section title={filters.status ? `Daily records — ${STATUS_LABEL[filters.status]}` : 'Daily records'}>
          <RecordsTable rows={latest} total={shownRecords.length} limit={RECORD_LIMIT} />
        </Section>
      )}
    </div>
  );
}
