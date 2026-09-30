import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  Building2, CalendarCheck, ClipboardList, FileUp, ScanFace, Store as StoreIcon, UserCheck, UserPlus, Users,
} from 'lucide-react';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { SMARTOFFICE_TIMEZONE } from '@/lib/config';
import { AUDIT_ACTIONS } from '@/lib/audit/catalog';
import { EMPLOYEE_SERIAL_MAX, EMPLOYEE_SERIAL_WARN_THRESHOLD } from '@/lib/ecode';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  AttentionList, EmptyNote, KpiCard, KpiGrid, PageHeader, QuickActions, Section, SegmentedBar, TrendBars, timeAgo,
  type AttentionItem, type Tone,
} from '@/components/dashboard/widgets';

export const metadata = {
  title: 'Dashboard | HRMS Platform',
};

const DAY_MS = 86_400_000;

// ─── Shared data helpers ────────────────────────────────────────────────────

/** "Today" the way the rest of the app defines it: the SmartOffice/IST calendar day. */
function todayBounds() {
  const now = new Date();
  const dateStr = formatInTimeZone(now, SMARTOFFICE_TIMEZONE, 'yyyy-MM-dd');
  const date = new Date(dateStr); // UTC midnight — matches ManualAttendanceEntry.date (@db.Date)
  const dayStart = fromZonedTime(`${dateStr} 00:00:00`, SMARTOFFICE_TIMEZONE);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  return { now, dateStr, date, dayStart, dayEnd, label: formatInTimeZone(now, SMARTOFFICE_TIMEZONE, 'EEEE, d MMMM yyyy') };
}

/**
 * Attendance snapshot for whatever stores `storeWhere` selects.
 *  - MANUAL stores: read from the Daily Register (this also covers phone face-scans there).
 *  - BIOMETRIC stores: anyone with a device (or phone face-scan) punch today counts as present.
 * Plus a 7-day "present" trend for MANUAL stores.
 */
async function attendanceSnapshot(storeWhere: Prisma.StoreWhereInput, t: ReturnType<typeof todayBounds>) {
  const manualStore: Prisma.StoreWhereInput = { AND: [storeWhere, { attendanceMode: 'MANUAL' }] };
  const bioStore: Prisma.StoreWhereInput = { AND: [storeWhere, { attendanceMode: 'BIOMETRIC' }] };
  const weekStart = new Date(t.date.getTime() - 6 * DAY_MS);

  const [manualTotal, byStatus, trendRows, bioTotal, bioStores] = await Promise.all([
    prisma.employee.count({ where: { status: 'ACTIVE', store: manualStore } }),
    prisma.manualAttendanceEntry.groupBy({
      by: ['status'],
      where: { date: t.date, employee: { status: 'ACTIVE', store: manualStore } },
      _count: { _all: true },
    }),
    prisma.manualAttendanceEntry.groupBy({
      by: ['date'],
      where: {
        date: { gte: weekStart, lte: t.date },
        status: { in: ['PRESENT', 'HALF_DAY'] },
        employee: { status: 'ACTIVE', store: manualStore },
      },
      _count: { _all: true },
    }),
    prisma.employee.count({ where: { status: 'ACTIVE', store: bioStore } }),
    prisma.store.findMany({
      where: bioStore,
      select: { id: true, devices: { select: { serialNumber: true } } },
    }),
  ]);

  // Biometric: who punched today on this scope's devices (or the phone face-scan virtual device)?
  let bioPunched = 0;
  if (bioTotal > 0) {
    const serials = bioStores.flatMap((s) => [`FACE-${s.id}`, ...s.devices.map((d) => d.serialNumber)]);
    const logs = await prisma.attendanceLog.findMany({
      where: { serialNumber: { in: serials }, logDate: { gte: t.dayStart, lt: t.dayEnd } },
      distinct: ['employeeCode'],
      select: { employeeCode: true },
    });
    if (logs.length > 0) {
      bioPunched = await prisma.employee.count({
        where: { status: 'ACTIVE', store: bioStore, staffCode: { in: logs.map((l) => l.employeeCode) } },
      });
    }
  }

  const n = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const marked = byStatus.reduce((a, r) => a + r._count._all, 0);
  const present = n('PRESENT');
  const half = n('HALF_DAY');

  const trendByDate = new Map(trendRows.map((r) => [r.date.toISOString().slice(0, 10), r._count._all]));
  const trend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(t.date.getTime() - (6 - i) * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    return {
      label: d.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' }),
      value: trendByDate.get(key) ?? 0,
      isToday: i === 6,
    };
  });

  return {
    manual: {
      total: manualTotal,
      marked,
      unmarked: Math.max(0, manualTotal - marked),
      present, half,
      leave: n('ON_LEAVE'),
      off: n('WEEK_OFF') + n('HOLIDAY'),
      absent: n('ABSENT'),
    },
    bio: { total: bioTotal, punched: bioPunched },
    trend,
    presentToday: present + half + bioPunched,
    trackedToday: manualTotal + bioTotal,
  };
}
type Snapshot = Awaited<ReturnType<typeof attendanceSnapshot>>;

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

/** Onboarding paperwork funnel for the given scope. */
async function formPipeline(storeWhere: Prisma.StoreWhereInput) {
  const rows = await prisma.employee.groupBy({
    by: ['onboardingFormStatus'],
    where: { status: 'ACTIVE', store: storeWhere },
    _count: { _all: true },
  });
  const n = (s: string) => rows.find((r) => r.onboardingFormStatus === s)?._count._all ?? 0;
  return { notSent: n('NOT_SENT'), pending: n('PENDING'), submitted: n('SUBMITTED') };
}

async function faceAdoption(storeWhere: Prisma.StoreWhereInput) {
  const faceStore: Prisma.StoreWhereInput = { AND: [storeWhere, { faceAttendanceEnabled: true }] };
  const [stores, total, enrolled] = await Promise.all([
    prisma.store.count({ where: faceStore }),
    prisma.employee.count({ where: { status: 'ACTIVE', store: faceStore } }),
    prisma.employee.count({ where: { status: 'ACTIVE', store: faceStore, faceTemplates: { some: {} } } }),
  ]);
  return { stores, total, enrolled };
}

const nearCapacityWhere = {
  nextEmployeeSerial: { gte: EMPLOYEE_SERIAL_MAX - EMPLOYEE_SERIAL_WARN_THRESHOLD + 1 },
};
const toCapacityRows = (rows: { id: string; name: string; nextEmployeeSerial: number }[]) =>
  rows.map((s) => ({ id: s.id, name: s.name, slotsLeft: Math.max(0, EMPLOYEE_SERIAL_MAX - s.nextEmployeeSerial + 1) }));

type RecentRow = { id: string; name: string; staffCode: string; store?: { name: string } };
const toRecent = (rows: RecentRow[]) =>
  rows.map((e) => ({ id: e.id, name: e.name, staffCode: e.staffCode, storeName: e.store?.name }));

// ─── Section components (page-specific) ─────────────────────────────────────

function AttendanceTodayCard({ snap, href }: { snap: Snapshot; href?: string }) {
  const { manual: m, bio: b } = snap;
  return (
    <Section title="Attendance today" action={href ? { href, label: 'Open register' } : undefined}>
      {m.total === 0 && b.total === 0 ? (
        <EmptyNote>No active employees to track yet.</EmptyNote>
      ) : (
        <div className="space-y-5">
          {m.total > 0 && (
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-sm font-medium">Register-based stores</p>
                <p className="text-xs text-muted-foreground">{m.marked} of {m.total} marked</p>
              </div>
              <SegmentedBar
                total={m.total}
                segments={[
                  { label: 'Present', value: m.present, color: 'bg-emerald-500' },
                  { label: 'Half day', value: m.half, color: 'bg-teal-400' },
                  { label: 'On leave', value: m.leave, color: 'bg-blue-400' },
                  { label: 'Week off / holiday', value: m.off, color: 'bg-slate-400' },
                  { label: 'Absent', value: m.absent, color: 'bg-red-500' },
                  { label: 'Not marked', value: m.unmarked, color: 'bg-amber-300' },
                ]}
              />
            </div>
          )}
          {b.total > 0 && (
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-sm font-medium">Biometric-device stores</p>
                <p className="text-xs text-muted-foreground">{b.punched} of {b.total} punched in</p>
              </div>
              <SegmentedBar
                total={b.total}
                segments={[
                  { label: 'Punched in', value: b.punched, color: 'bg-emerald-500' },
                  { label: 'No punch yet', value: b.total - b.punched, color: 'bg-amber-300' },
                ]}
              />
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function TrendCard({ snap }: { snap: Snapshot }) {
  if (snap.manual.total === 0) return null;
  return (
    <Section title="Present — last 7 days">
      <TrendBars days={snap.trend} total={snap.manual.total} />
      <p className="mt-3 text-xs text-muted-foreground">Present + half-day, register-based stores.</p>
    </Section>
  );
}

function FormPipelineCard({ p, href }: { p: Awaited<ReturnType<typeof formPipeline>>; href: string }) {
  const total = p.notSent + p.pending + p.submitted;
  return (
    <Section title="Onboarding paperwork" action={{ href, label: 'View forms' }}>
      <SegmentedBar
        total={total}
        emptyText="No active employees yet."
        segments={[
          { label: 'Submitted', value: p.submitted, color: 'bg-emerald-500' },
          { label: 'Waiting on employee', value: p.pending, color: 'bg-amber-400' },
          { label: 'Link not sent', value: p.notSent, color: 'bg-slate-300' },
        ]}
      />
    </Section>
  );
}

function FaceAdoptionCard({ f }: { f: Awaited<ReturnType<typeof faceAdoption>> }) {
  if (f.stores === 0) return null;
  const share = f.total > 0 ? Math.round((f.enrolled / f.total) * 100) : 0;
  return (
    <Section title="Face attendance">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{f.enrolled} of {f.total} employees enrolled</span>
        <span className="font-semibold tabular-nums">{share}%</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Switched on in {f.stores} store{f.stores === 1 ? '' : 's'}.
        {f.total - f.enrolled > 0 && ` ${f.total - f.enrolled} still to enroll.`}
      </p>
    </Section>
  );
}

function RecentEmployees({
  employees,
}: {
  employees: { id: string; name: string; staffCode: string; storeName?: string }[];
}) {
  return (
    <Section title="Recently onboarded" action={{ href: '/employees', label: 'All employees' }}>
      {employees.length === 0 ? (
        <EmptyNote>No employees onboarded yet.</EmptyNote>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {employees.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900 dark:text-white">{e.name}</p>
                {e.storeName && <p className="truncate text-xs text-muted-foreground">{e.storeName}</p>}
              </div>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{e.staffCode}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Shown only when some store is close to running out of its 900 employee codes. */
function CapacityWarning({ stores }: { stores: { id: string; name: string; slotsLeft: number }[] }) {
  if (stores.length === 0) return null;
  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardContent className="p-4 sm:p-5">
        <h2 className="text-base font-semibold text-amber-700 dark:text-amber-400">Stores running out of employee codes</h2>
        <ul className="mt-2 divide-y divide-gray-100 text-sm dark:divide-gray-800">
          {stores.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2">
              <span className="font-medium">{s.name}</span>
              <span className={s.slotsLeft === 0 ? 'font-semibold text-red-600' : 'text-amber-700 dark:text-amber-400'}>
                {s.slotsLeft === 0 ? 'Full' : `${s.slotsLeft} left`}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          When a store is full, add another store entry for the same location to keep onboarding.
        </p>
      </CardContent>
    </Card>
  );
}

function OfflineDevices({
  devices, now,
}: {
  devices: { id: string; name: string; lastPing: Date | null; store: { name: string } }[];
  now: Date;
}) {
  if (devices.length === 0) return null;
  return (
    <Section title="Devices offline" action={{ href: '/devices', label: 'All devices' }}>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{d.name}</p>
              <p className="truncate text-xs text-muted-foreground">{d.store.name}</p>
            </div>
            <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">seen {timeAgo(d.lastPing, now)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function RecentActivity({
  rows, now,
}: {
  rows: { id: string; action: string; createdAt: Date; user: { name: string } }[];
  now: Date;
}) {
  return (
    <Section title="Recent activity" action={{ href: '/audit-log', label: 'Audit log' }}>
      {rows.length === 0 ? (
        <EmptyNote>No activity recorded yet.</EmptyNote>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((r) => {
            const meta = AUDIT_ACTIONS[r.action];
            const dot = meta?.severity === 'critical' ? 'bg-red-500' : meta?.severity === 'notice' ? 'bg-amber-500' : 'bg-slate-300';
            return (
              <li key={r.id} className="flex items-start gap-3 py-2.5 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{meta?.label ?? r.action}</p>
                  <p className="truncate text-xs text-muted-foreground">by {r.user.name}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(r.createdAt, now)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function TeamMix({ rows }: { rows: { designation: string; count: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <Section title="Team mix">
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => (
          <Badge key={r.designation} variant="outline" className="gap-1.5 px-2.5 py-1 text-sm font-normal">
            {r.designation.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
            <span className="font-semibold tabular-nums">{r.count}</span>
          </Badge>
        ))}
      </div>
    </Section>
  );
}

const shell = 'mx-auto w-full max-w-7xl space-y-5 p-4 sm:space-y-6 sm:p-6 lg:p-8';

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { role, storeId, clientId, name } = session.user;
  const greeting = `Welcome back${name ? `, ${name.split(' ')[0]}` : ''}.`;
  const t = todayBounds();

  // ── ADMIN: whole platform, plus the things only an admin can act on ──
  if (role === 'ADMIN') {
    const all: Prisma.StoreWhereInput = {};
    const [
      clientCount, storeCount, activeEmployees, pendingForms, failedSync, queued, offlineDevices, offlineList,
      lateRequests, missedPeriods, unmatchedForms, nearFull, recent, activity, snap, pipeline, face,
    ] = await Promise.all([
      prisma.client.count(),
      prisma.store.count(),
      prisma.employee.count({ where: { status: 'ACTIVE' } }),
      prisma.employee.count({ where: { onboardingFormStatus: 'PENDING' } }),
      prisma.smartOfficeCommand.count({ where: { status: 'FAILED' } }),
      prisma.smartOfficeCommand.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
      prisma.device.count({ where: { isOnline: false } }),
      prisma.device.findMany({
        where: { isOnline: false },
        orderBy: { lastPing: 'asc' },
        take: 5,
        select: { id: true, name: true, lastPing: true, store: { select: { name: true } } },
      }),
      prisma.lateUploadRequest.count({ where: { status: 'PENDING' } }),
      prisma.attendancePeriod.count({ where: { status: 'MISSED' } }),
      prisma.unmatchedFormSubmission.count({ where: { resolvedAt: null } }),
      prisma.store.findMany({ where: nearCapacityWhere, select: { id: true, name: true, nextEmployeeSerial: true } }),
      prisma.employee.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, name: true, staffCode: true, store: { select: { name: true } } },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, action: true, createdAt: true, user: { select: { name: true } } },
      }),
      attendanceSnapshot(all, t),
      formPipeline(all),
      faceAdoption(all),
    ]);

    const attention: AttentionItem[] = [
      { label: 'Failed SmartOffice syncs', count: failedSync, href: '/sync-issues', tone: 'danger', hint: queued > 0 ? `${queued} more waiting in the queue` : undefined },
      { label: 'Late upload requests awaiting you', count: lateRequests, href: '/attendance/deadlines', tone: 'warning' },
      { label: 'Stores that missed the attendance deadline', count: missedPeriods, href: '/attendance/deadlines', tone: 'danger' },
      { label: 'Devices offline', count: offlineDevices, href: '/devices', tone: 'warning' },
      { label: 'Pending onboarding forms', count: pendingForms, href: '/onboarding/pending-forms', tone: 'warning' },
      { label: 'Unmatched form submissions', count: unmatchedForms, href: '/onboarding/pending-forms', tone: 'warning', hint: 'Received but not linked to an employee' },
    ];

    return (
      <div className={shell}>
        <PageHeader title="Dashboard" subtitle={`${greeting} Here's what needs attention across the platform.`} dateLabel={t.label} />

        <KpiGrid>
          <KpiCard
            label="Present today"
            value={snap.presentToday}
            hint={`${pct(snap.presentToday, snap.trackedToday)} of ${snap.trackedToday} tracked`}
            icon={UserCheck}
            tone={snap.trackedToday > 0 && snap.presentToday / snap.trackedToday < 0.6 ? 'warning' : 'good'}
            href="/attendance"
          />
          <KpiCard label="Active employees" value={activeEmployees} icon={Users} href="/employees" />
          <KpiCard label="Stores" value={storeCount} icon={StoreIcon} href="/stores" />
          <KpiCard label="Clients" value={clientCount} icon={Building2} href="/stores" />
        </KpiGrid>

        <div className="grid gap-5 sm:gap-6 lg:grid-cols-3">
          <div className="space-y-5 sm:space-y-6 lg:col-span-2">
            <AttentionList items={attention} />
            <AttendanceTodayCard snap={snap} href="/attendance" />
            <TrendCard snap={snap} />
          </div>
          <div className="space-y-5 sm:space-y-6">
            <FormPipelineCard p={pipeline} href="/onboarding/pending-forms" />
            <FaceAdoptionCard f={face} />
            <OfflineDevices devices={offlineList} now={t.now} />
            <CapacityWarning stores={toCapacityRows(nearFull)} />
            <RecentEmployees employees={toRecent(recent)} />
            <RecentActivity rows={activity} now={t.now} />
          </div>
        </div>
      </div>
    );
  }

  // ── CLIENT: only their own stores, with a per-store breakdown ──
  if (role === 'CLIENT') {
    const storeWhere: Prisma.StoreWhereInput = { clientId: clientId ?? '__none__' };
    const [
      stores, activeByStore, pendingByStore, offlineByStore, offlineList, missedPeriods, nearFull, recent, snap, pipeline, face,
    ] = await Promise.all([
      prisma.store.findMany({
        where: storeWhere,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, location: true, attendanceMode: true, faceAttendanceEnabled: true },
      }),
      prisma.employee.groupBy({ by: ['storeId'], where: { status: 'ACTIVE', store: storeWhere }, _count: { _all: true } }),
      prisma.employee.groupBy({ by: ['storeId'], where: { onboardingFormStatus: 'PENDING', store: storeWhere }, _count: { _all: true } }),
      prisma.device.groupBy({ by: ['storeId'], where: { isOnline: false, store: storeWhere }, _count: { _all: true } }),
      prisma.device.findMany({
        where: { isOnline: false, store: storeWhere },
        orderBy: { lastPing: 'asc' },
        take: 5,
        select: { id: true, name: true, lastPing: true, store: { select: { name: true } } },
      }),
      prisma.attendancePeriod.count({ where: { status: 'MISSED', store: storeWhere } }),
      prisma.store.findMany({ where: { ...storeWhere, ...nearCapacityWhere }, select: { id: true, name: true, nextEmployeeSerial: true } }),
      prisma.employee.findMany({
        where: { store: storeWhere },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, name: true, staffCode: true, store: { select: { name: true } } },
      }),
      attendanceSnapshot(storeWhere, t),
      formPipeline(storeWhere),
      faceAdoption(storeWhere),
    ]);

    const count = (rows: { storeId: string; _count: { _all: number } }[]) =>
      new Map(rows.map((r) => [r.storeId, r._count._all]));
    const active = count(activeByStore);
    const pending = count(pendingByStore);
    const offline = count(offlineByStore);
    const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

    const attention: AttentionItem[] = [
      { label: 'Stores that missed the attendance deadline', count: missedPeriods, href: '/attendance', tone: 'danger' },
      { label: 'Devices offline', count: sum(offline), href: '/devices', tone: 'warning' },
      { label: 'Pending onboarding forms', count: sum(pending), href: '/onboarding/pending-forms', tone: 'warning' },
      { label: 'Attendance not marked today', count: snap.manual.unmarked, href: '/attendance', tone: 'warning', hint: 'Register-based stores' },
    ];

    return (
      <div className={shell}>
        <PageHeader title="Dashboard" subtitle={`${greeting} Here's how your stores are doing.`} dateLabel={t.label} />

        <KpiGrid>
          <KpiCard
            label="Present today"
            value={snap.presentToday}
            hint={`${pct(snap.presentToday, snap.trackedToday)} of ${snap.trackedToday} tracked`}
            icon={UserCheck}
            tone={snap.trackedToday > 0 && snap.presentToday / snap.trackedToday < 0.6 ? 'warning' : 'good'}
            href="/attendance"
          />
          <KpiCard label="Active employees" value={sum(active)} icon={Users} href="/employees" />
          <KpiCard label="Your stores" value={stores.length} icon={StoreIcon} href="/stores" />
          <KpiCard
            label="Pending onboarding forms"
            value={sum(pending)}
            icon={ClipboardList}
            href="/onboarding/pending-forms"
            tone={sum(pending) > 0 ? 'warning' : 'default'}
          />
        </KpiGrid>

        <div className="grid gap-5 sm:gap-6 lg:grid-cols-3">
          <div className="space-y-5 sm:space-y-6 lg:col-span-2">
            <AttentionList items={attention} />
            <AttendanceTodayCard snap={snap} href="/attendance" />

            <Section title="Your stores" action={{ href: '/stores', label: 'Manage' }}>
              {stores.length === 0 ? (
                <EmptyNote>No stores yet. Add one from Stores &amp; Brands.</EmptyNote>
              ) : (
                <>
                  {/* Desktop / tablet: table */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">Store</th>
                          <th className="py-2 pr-4 font-medium">Attendance</th>
                          <th className="py-2 pr-4 text-right font-medium">Active</th>
                          <th className="py-2 pr-4 text-right font-medium">Forms pending</th>
                          <th className="py-2 text-right font-medium">Devices offline</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {stores.map((s) => (
                          <tr key={s.id}>
                            <td className="py-2.5 pr-4">
                              <p className="font-medium">{s.name}</p>
                              <p className="text-xs text-muted-foreground">{s.location || '—'}</p>
                            </td>
                            <td className="py-2.5 pr-4">
                              <Badge variant="outline" className="font-normal">
                                {s.attendanceMode === 'BIOMETRIC' ? 'Biometric device' : 'Register'}
                                {s.faceAttendanceEnabled ? ' + face' : ''}
                              </Badge>
                            </td>
                            <td className="py-2.5 pr-4 text-right tabular-nums">{active.get(s.id) ?? 0}</td>
                            <td className={`py-2.5 pr-4 text-right tabular-nums ${(pending.get(s.id) ?? 0) > 0 ? 'font-semibold text-amber-600' : ''}`}>
                              {pending.get(s.id) ?? 0}
                            </td>
                            <td className={`py-2.5 text-right tabular-nums ${(offline.get(s.id) ?? 0) > 0 ? 'font-semibold text-amber-600' : ''}`}>
                              {offline.get(s.id) ?? 0}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Phones: one card per store */}
                  <ul className="space-y-3 md:hidden">
                    {stores.map((s) => (
                      <li key={s.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{s.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{s.location || '—'}</p>
                          </div>
                          <Badge variant="outline" className="shrink-0 text-[11px] font-normal">
                            {s.attendanceMode === 'BIOMETRIC' ? 'Device' : 'Register'}{s.faceAttendanceEnabled ? ' + face' : ''}
                          </Badge>
                        </div>
                        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                          <div>
                            <dd className="text-lg font-bold tabular-nums">{active.get(s.id) ?? 0}</dd>
                            <dt className="text-[11px] text-muted-foreground">Active</dt>
                          </div>
                          <div>
                            <dd className={`text-lg font-bold tabular-nums ${(pending.get(s.id) ?? 0) > 0 ? 'text-amber-600' : ''}`}>{pending.get(s.id) ?? 0}</dd>
                            <dt className="text-[11px] text-muted-foreground">Forms pending</dt>
                          </div>
                          <div>
                            <dd className={`text-lg font-bold tabular-nums ${(offline.get(s.id) ?? 0) > 0 ? 'text-amber-600' : ''}`}>{offline.get(s.id) ?? 0}</dd>
                            <dt className="text-[11px] text-muted-foreground">Offline</dt>
                          </div>
                        </dl>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>

            <TrendCard snap={snap} />
          </div>
          <div className="space-y-5 sm:space-y-6">
            <FormPipelineCard p={pipeline} href="/onboarding/pending-forms" />
            <FaceAdoptionCard f={face} />
            <OfflineDevices devices={offlineList} now={t.now} />
            <CapacityWarning stores={toCapacityRows(nearFull)} />
            <RecentEmployees employees={toRecent(recent)} />
          </div>
        </div>
      </div>
    );
  }

  // ── MANAGER / SHIFT_INCHARGE / PROCESS_ASSOCIATE: one store, and only
  //    the widgets this role is actually allowed to act on ──
  if (!storeId) {
    return (
      <div className={shell}>
        <PageHeader title="Dashboard" subtitle={`${greeting} Your account isn't assigned to a store yet — ask an admin to assign one.`} dateLabel={t.label} />
      </div>
    );
  }

  const canSeeForms = can(session, 'formTracking:view', { storeId });
  const canMarkAttendance = can(session, 'attendance:manualEntry', { storeId });
  const canRequestLate = can(session, 'attendance:lateAccess:request', { storeId });
  const canSeeAttendance = can(session, 'attendance:view', { storeId }) || canMarkAttendance;
  const canFacePunch = can(session, 'attendance:facePunch', { storeId });
  const canUpload = can(session, 'attendance:csvUpload', { storeId });
  const canOnboard = can(session, 'employee:create', { storeId });

  const storeWhere: Prisma.StoreWhereInput = { id: storeId };
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { name: true, attendanceMode: true, faceAttendanceEnabled: true },
  });

  const [activeEmployees, pendingForms, period, recent, snap, pipeline, mix] = await Promise.all([
    prisma.employee.count({ where: { status: 'ACTIVE', storeId } }),
    canSeeForms ? prisma.employee.count({ where: { onboardingFormStatus: 'PENDING', storeId } }) : Promise.resolve(null),
    canRequestLate
      ? prisma.attendancePeriod.findFirst({
          where: { storeId, status: { notIn: ['CLOSED', 'CLOSED_LATE'] } },
          orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
          select: { periodYear: true, periodMonth: true, status: true, deadlineAt: true },
        })
      : Promise.resolve(null),
    prisma.employee.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, name: true, staffCode: true },
    }),
    canSeeAttendance ? attendanceSnapshot(storeWhere, t) : Promise.resolve(null),
    canSeeForms ? formPipeline(storeWhere) : Promise.resolve(null),
    prisma.employee.groupBy({ by: ['designation'], where: { status: 'ACTIVE', storeId }, _count: { _all: true } }),
  ]);

  const periodCard = period && (() => {
    const month = new Date(period.periodYear, period.periodMonth - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
    const due = period.deadlineAt.toLocaleDateString('en', { day: 'numeric', month: 'short' });
    const map: Record<string, { value: string; hint: string; tone: Tone; attention?: 'danger' | 'warning' }> = {
      OPEN: { value: `Due ${due}`, hint: 'Upload before the deadline', tone: 'default' },
      MISSED: { value: 'Missed', hint: 'Request late access to upload', tone: 'danger', attention: 'danger' },
      LATE_REQUESTED: { value: 'Awaiting admin', hint: 'Late access requested', tone: 'warning' },
      LATE_GRANTED: { value: 'Late upload open', hint: 'Admin approved — upload now', tone: 'warning', attention: 'warning' },
      LATE_DENIED: { value: 'Denied', hint: 'You can file a new request', tone: 'danger', attention: 'danger' },
    };
    const m = map[period.status];
    return m ? { label: `Attendance — ${month}`, ...m } : null;
  })();

  const isManualStore = store?.attendanceMode === 'MANUAL';
  const attention: AttentionItem[] = [];
  if (snap && canMarkAttendance && isManualStore) {
    attention.push({ label: 'Attendance not marked today', count: snap.manual.unmarked, href: '/attendance/manual', tone: 'warning', hint: `${snap.manual.marked} of ${snap.manual.total} marked so far` });
  }
  if (pendingForms) {
    attention.push({ label: 'Pending onboarding forms', count: pendingForms, href: '/onboarding/pending-forms', tone: 'warning' });
  }
  if (periodCard?.attention) {
    attention.push({ label: periodCard.label, count: 1, href: '/attendance/upload', tone: periodCard.attention, hint: periodCard.hint });
  }

  const actions = [
    canMarkAttendance && isManualStore && { href: '/attendance/manual', label: 'Mark attendance', icon: CalendarCheck },
    canFacePunch && isManualStore && store?.faceAttendanceEnabled && { href: '/face-attendance', label: 'Face attendance', icon: ScanFace },
    canOnboard && { href: '/onboarding', label: 'Onboard employee', icon: UserPlus },
    canUpload && { href: '/attendance/upload', label: 'Upload attendance', icon: FileUp },
  ].filter((a): a is { href: string; label: string; icon: typeof Users } => !!a);

  const presentTone: Tone = snap && snap.trackedToday > 0 && snap.presentToday / snap.trackedToday < 0.6 ? 'warning' : 'good';

  return (
    <div className={shell}>
      <PageHeader title="Dashboard" subtitle={`${greeting}${store ? ` Overview for ${store.name}.` : ''}`} dateLabel={t.label} />

      <QuickActions actions={actions} />

      <KpiGrid>
        <KpiCard label="Active employees" value={activeEmployees} icon={Users} href="/employees" />
        {snap && (
          <KpiCard
            label="Present today"
            value={snap.trackedToday > 0 ? `${snap.presentToday} / ${snap.trackedToday}` : '—'}
            hint={snap.trackedToday > 0 ? `${pct(snap.presentToday, snap.trackedToday)} attendance` : undefined}
            icon={UserCheck}
            tone={presentTone}
            href={canMarkAttendance && isManualStore ? '/attendance/manual' : '/attendance'}
          />
        )}
        {pendingForms !== null && (
          <KpiCard
            label="Pending onboarding forms"
            value={pendingForms}
            icon={ClipboardList}
            href="/onboarding/pending-forms"
            tone={pendingForms > 0 ? 'warning' : 'default'}
          />
        )}
        {periodCard && (
          <KpiCard label={periodCard.label} value={periodCard.value} hint={periodCard.hint} tone={periodCard.tone} icon={CalendarCheck} href="/attendance/upload" />
        )}
      </KpiGrid>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-3">
        <div className="space-y-5 sm:space-y-6 lg:col-span-2">
          {attention.length > 0 || canMarkAttendance || pendingForms !== null ? <AttentionList items={attention} /> : null}
          {snap && <AttendanceTodayCard snap={snap} href={canMarkAttendance && isManualStore ? '/attendance/manual' : '/attendance'} />}
          {snap && <TrendCard snap={snap} />}
        </div>
        <div className="space-y-5 sm:space-y-6">
          {pipeline && <FormPipelineCard p={pipeline} href="/onboarding/pending-forms" />}
          <TeamMix rows={mix.map((r) => ({ designation: r.designation, count: r._count._all }))} />
          <RecentEmployees employees={recent} />
        </div>
      </div>
    </div>
  );
}
