import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { EMPLOYEE_SERIAL_MAX, EMPLOYEE_SERIAL_WARN_THRESHOLD } from '@/lib/ecode';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = {
  title: 'Dashboard | HRMS Platform',
};

type Tone = 'default' | 'warning' | 'danger';

function StatCard({
  label,
  value,
  href,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  href?: string;
  hint?: string;
  tone?: Tone;
}) {
  const valueClass =
    tone === 'danger'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-gray-900 dark:text-white';

  const body = (
    <Card className={href ? 'h-full transition-colors hover:border-primary/40' : 'h-full'}>
      <CardContent className="p-5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 text-3xl font-bold ${valueClass}`}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}

function RecentEmployees({
  employees,
}: {
  employees: { id: string; name: string; staffCode: string; storeName?: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recently onboarded</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {employees.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No employees onboarded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {employees.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{e.name}</p>
                  {e.storeName && <p className="text-xs text-muted-foreground">{e.storeName}</p>}
                </div>
                <span className="font-mono text-xs text-muted-foreground">{e.staffCode}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Shown only when some store is close to running out of its 900 employee codes. */
function CapacityWarning({ stores }: { stores: { id: string; name: string; slotsLeft: number }[] }) {
  if (stores.length === 0) return null;
  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardHeader>
        <CardTitle className="text-base text-amber-700 dark:text-amber-400">Stores running out of employee codes</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
          {stores.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2">
              <span className="font-medium">{s.name}</span>
              <span className={s.slotsLeft === 0 ? 'text-red-600 font-semibold' : 'text-amber-700 dark:text-amber-400'}>
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

const nearCapacityWhere = {
  nextEmployeeSerial: { gte: EMPLOYEE_SERIAL_MAX - EMPLOYEE_SERIAL_WARN_THRESHOLD + 1 },
};
const toCapacityRows = (rows: { id: string; name: string; nextEmployeeSerial: number }[]) =>
  rows.map((s) => ({ id: s.id, name: s.name, slotsLeft: Math.max(0, EMPLOYEE_SERIAL_MAX - s.nextEmployeeSerial + 1) }));

type RecentRow = { id: string; name: string; staffCode: string; store?: { name: string } };
const toRecent = (rows: RecentRow[]) =>
  rows.map((e) => ({ id: e.id, name: e.name, staffCode: e.staffCode, storeName: e.store?.name }));

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { role, storeId, clientId, name } = session.user;
  const greeting = `Welcome back${name ? `, ${name.split(' ')[0]}` : ''}.`;

  // ── ADMIN: whole platform, plus the things only an admin can act on ──
  if (role === 'ADMIN') {
    const [
      clientCount, storeCount, activeEmployees, pendingForms,
      failedSync, offlineDevices, lateRequests, unmatchedForms, nearFull, recent,
    ] = await Promise.all([
      prisma.client.count(),
      prisma.store.count(),
      prisma.employee.count({ where: { status: 'ACTIVE' } }),
      prisma.employee.count({ where: { onboardingFormStatus: 'PENDING' } }),
      prisma.smartOfficeCommand.count({ where: { status: 'FAILED' } }),
      prisma.device.count({ where: { isOnline: false } }),
      prisma.lateUploadRequest.count({ where: { status: 'PENDING' } }),
      prisma.unmatchedFormSubmission.count({ where: { resolvedAt: null } }),
      prisma.store.findMany({ where: nearCapacityWhere, select: { id: true, name: true, nextEmployeeSerial: true } }),
      prisma.employee.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, name: true, staffCode: true, store: { select: { name: true } } },
      }),
    ]);

    return (
      <main className="p-8 space-y-6">
        <Header title="Dashboard" subtitle={`${greeting} Here's what needs attention across the platform.`} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Late upload requests awaiting you"
            value={lateRequests}
            href="/attendance/deadlines"
            tone={lateRequests > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Failed SmartOffice syncs"
            value={failedSync}
            href="/sync-issues"
            tone={failedSync > 0 ? 'danger' : 'default'}
          />
          <StatCard
            label="Pending onboarding forms"
            value={pendingForms}
            href="/onboarding/pending-forms"
            tone={pendingForms > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Unmatched form submissions"
            value={unmatchedForms}
            hint={unmatchedForms > 0 ? 'Received but not linked to an employee' : undefined}
            tone={unmatchedForms > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Devices offline"
            value={offlineDevices}
            href="/devices"
            tone={offlineDevices > 0 ? 'warning' : 'default'}
          />
          <StatCard label="Active employees" value={activeEmployees} href="/employees" />
          <StatCard label="Stores" value={storeCount} href="/stores" />
          <StatCard label="Clients" value={clientCount} href="/stores" />
        </div>

        <CapacityWarning stores={toCapacityRows(nearFull)} />
        <RecentEmployees employees={toRecent(recent)} />
      </main>
    );
  }

  // ── CLIENT: only their own stores, with a per-store breakdown ──
  if (role === 'CLIENT') {
    const storeWhere = { clientId: clientId ?? '__none__' };
    const [stores, activeByStore, pendingByStore, offlineByStore, nearFull, recent] = await Promise.all([
      prisma.store.findMany({
        where: storeWhere,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, location: true },
      }),
      prisma.employee.groupBy({ by: ['storeId'], where: { status: 'ACTIVE', store: storeWhere }, _count: { _all: true } }),
      prisma.employee.groupBy({ by: ['storeId'], where: { onboardingFormStatus: 'PENDING', store: storeWhere }, _count: { _all: true } }),
      prisma.device.groupBy({ by: ['storeId'], where: { isOnline: false, store: storeWhere }, _count: { _all: true } }),
      prisma.store.findMany({ where: { ...storeWhere, ...nearCapacityWhere }, select: { id: true, name: true, nextEmployeeSerial: true } }),
      prisma.employee.findMany({
        where: { store: storeWhere },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, name: true, staffCode: true, store: { select: { name: true } } },
      }),
    ]);

    const count = (rows: { storeId: string; _count: { _all: number } }[]) =>
      new Map(rows.map((r) => [r.storeId, r._count._all]));
    const active = count(activeByStore);
    const pending = count(pendingByStore);
    const offline = count(offlineByStore);
    const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

    return (
      <main className="p-8 space-y-6">
        <Header title="Dashboard" subtitle={`${greeting} Here's how your stores are doing.`} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Your stores" value={stores.length} href="/stores" />
          <StatCard label="Active employees" value={sum(active)} href="/employees" />
          <StatCard
            label="Pending onboarding forms"
            value={sum(pending)}
            href="/onboarding/pending-forms"
            tone={sum(pending) > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Devices offline"
            value={sum(offline)}
            href="/devices"
            tone={sum(offline) > 0 ? 'warning' : 'default'}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your stores</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 overflow-x-auto">
            {stores.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No stores yet. Add one from Stores &amp; Brands.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-4 font-medium">Store</th>
                    <th className="py-2 pr-4 font-medium">Location</th>
                    <th className="py-2 pr-4 font-medium text-right">Active</th>
                    <th className="py-2 pr-4 font-medium text-right">Forms pending</th>
                    <th className="py-2 font-medium text-right">Devices offline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {stores.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2.5 pr-4 font-medium">{s.name}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{s.location || '—'}</td>
                      <td className="py-2.5 pr-4 text-right">{active.get(s.id) ?? 0}</td>
                      <td className={`py-2.5 pr-4 text-right ${(pending.get(s.id) ?? 0) > 0 ? 'text-amber-600 font-semibold' : ''}`}>
                        {pending.get(s.id) ?? 0}
                      </td>
                      <td className={`py-2.5 text-right ${(offline.get(s.id) ?? 0) > 0 ? 'text-amber-600 font-semibold' : ''}`}>
                        {offline.get(s.id) ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <CapacityWarning stores={toCapacityRows(nearFull)} />
        <RecentEmployees employees={toRecent(recent)} />
      </main>
    );
  }

  // ── MANAGER / SHIFT_INCHARGE / PROCESS_ASSOCIATE: one store, and only
  //    the widgets this role is actually allowed to act on ──
  if (!storeId) {
    return (
      <main className="p-8">
        <Header title="Dashboard" subtitle={`${greeting} Your account isn't assigned to a store yet — ask an admin to assign one.`} />
      </main>
    );
  }

  const canSeeForms = can(session, 'formTracking:view', { storeId });
  const canMarkAttendance = can(session, 'attendance:manualEntry', { storeId });
  const canRequestLate = can(session, 'attendance:lateAccess:request', { storeId });

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTomorrow = new Date(startToday.getTime() + 86400000);

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { name: true, attendanceMode: true },
  });

  const [activeEmployees, pendingForms, marked, period, recent] = await Promise.all([
    prisma.employee.count({ where: { status: 'ACTIVE', storeId } }),
    canSeeForms ? prisma.employee.count({ where: { onboardingFormStatus: 'PENDING', storeId } }) : Promise.resolve(null),
    canMarkAttendance && store?.attendanceMode === 'MANUAL'
      ? prisma.manualAttendanceEntry.count({
          where: { date: { gte: startToday, lt: startTomorrow }, employee: { storeId, status: 'ACTIVE' } },
        })
      : Promise.resolve(null),
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
  ]);

  const periodCard = period && (() => {
    const month = new Date(period.periodYear, period.periodMonth - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
    const due = period.deadlineAt.toLocaleDateString('en', { day: 'numeric', month: 'short' });
    const map: Record<string, { value: string; hint: string; tone: Tone }> = {
      OPEN: { value: `Due ${due}`, hint: 'Upload before the deadline', tone: 'default' },
      MISSED: { value: 'Missed', hint: 'Request late access to upload', tone: 'danger' },
      LATE_REQUESTED: { value: 'Awaiting admin', hint: 'Late access requested', tone: 'warning' },
      LATE_GRANTED: { value: 'Late upload open', hint: 'Admin approved — upload now', tone: 'warning' },
      LATE_DENIED: { value: 'Denied', hint: 'You can file a new request', tone: 'danger' },
    };
    const m = map[period.status];
    return m ? { label: `Attendance — ${month}`, ...m } : null;
  })();

  return (
    <main className="p-8 space-y-6">
      <Header title="Dashboard" subtitle={`${greeting}${store ? ` Overview for ${store.name}.` : ''}`} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active employees" value={activeEmployees} href="/employees" />
        {pendingForms !== null && (
          <StatCard
            label="Pending onboarding forms"
            value={pendingForms}
            href="/onboarding/pending-forms"
            tone={pendingForms > 0 ? 'warning' : 'default'}
          />
        )}
        {marked !== null && (
          <StatCard
            label="Attendance marked today"
            value={`${marked} / ${activeEmployees}`}
            href="/attendance/manual"
            tone={marked < activeEmployees ? 'warning' : 'default'}
          />
        )}
        {periodCard && (
          <StatCard label={periodCard.label} value={periodCard.value} hint={periodCard.hint} tone={periodCard.tone} href="/attendance/upload" />
        )}
      </div>

      <RecentEmployees employees={recent} />
    </main>
  );
}
