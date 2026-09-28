import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = {
  title: 'Dashboard | HRMS Platform',
};

function StatCard({
  label,
  value,
  href,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const valueClass =
    tone === 'danger'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-gray-900 dark:text-white';

  const body = (
    <Card className={href ? 'transition-colors hover:border-primary/40' : undefined}>
      <CardContent className="p-5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 text-3xl font-bold ${valueClass}`}>{value}</p>
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground py-6 text-center">{children}</p>;
}

function EmployeeList({
  employees,
}: {
  employees: { id: string; name: string; staffCode: string; storeName?: string }[];
}) {
  if (employees.length === 0) return <EmptyRow>No employees onboarded yet.</EmptyRow>;
  return (
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
  );
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { role, storeId, clientId, name } = session.user;
  const greeting = `Welcome back${name ? `, ${name.split(' ')[0]}` : ''}.`;

  // ── ADMIN: system-wide view ──────────────────────────────────────────
  if (role === 'ADMIN') {
    const [clientCount, storeCount, activeEmployees, pendingForms, failedSync, offlineDevices, recent] =
      await Promise.all([
        prisma.client.count(),
        prisma.store.count(),
        prisma.employee.count({ where: { status: 'ACTIVE' } }),
        prisma.employee.count({ where: { onboardingFormStatus: 'PENDING' } }),
        prisma.smartOfficeCommand.count({ where: { status: 'FAILED' } }),
        prisma.device.count({ where: { isOnline: false } }),
        prisma.employee.findMany({
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { id: true, name: true, staffCode: true, store: { select: { name: true } } },
        }),
      ]);

    return (
      <main className="p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">{greeting} Here&apos;s what&apos;s happening across the platform.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Clients" value={clientCount} href="/stores" />
          <StatCard label="Stores" value={storeCount} href="/stores" />
          <StatCard label="Active employees" value={activeEmployees} href="/employees" />
          <StatCard
            label="Pending onboarding forms"
            value={pendingForms}
            href="/onboarding/pending-forms"
            tone={pendingForms > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Failed SmartOffice syncs"
            value={failedSync}
            href="/sync-issues"
            tone={failedSync > 0 ? 'danger' : 'default'}
          />
          <StatCard
            label="Devices offline"
            value={offlineDevices}
            href="/devices"
            tone={offlineDevices > 0 ? 'warning' : 'default'}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently onboarded</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <EmployeeList
              employees={recent.map((e: { id: string; name: string; staffCode: string; store: { name: string } }) => ({ id: e.id, name: e.name, staffCode: e.staffCode, storeName: e.store.name }))}
            />
          </CardContent>
        </Card>
      </main>
    );
  }

  // ── CLIENT: scoped to their own stores ───────────────────────────────
  if (role === 'CLIENT') {
    const storeWhere = { clientId: clientId ?? '__none__' };
    const [storeCount, activeEmployees, pendingForms, offlineDevices, recent] = await Promise.all([
      prisma.store.count({ where: storeWhere }),
      prisma.employee.count({ where: { status: 'ACTIVE', store: storeWhere } }),
      prisma.employee.count({ where: { onboardingFormStatus: 'PENDING', store: storeWhere } }),
      prisma.device.count({ where: { isOnline: false, store: storeWhere } }),
      prisma.employee.findMany({
        where: { store: storeWhere },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, name: true, staffCode: true, store: { select: { name: true } } },
      }),
    ]);

    return (
      <main className="p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">{greeting} Here&apos;s how your stores are doing.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Your stores" value={storeCount} href="/stores" />
          <StatCard label="Active employees" value={activeEmployees} href="/employees" />
          <StatCard
            label="Pending onboarding forms"
            value={pendingForms}
            href="/onboarding/pending-forms"
            tone={pendingForms > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Devices offline"
            value={offlineDevices}
            href="/devices"
            tone={offlineDevices > 0 ? 'warning' : 'default'}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently onboarded</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <EmployeeList
              employees={recent.map((e: { id: string; name: string; staffCode: string; store: { name: string } }) => ({ id: e.id, name: e.name, staffCode: e.staffCode, storeName: e.store.name }))}
            />
          </CardContent>
        </Card>
      </main>
    );
  }

  // ── MANAGER / SHIFT_INCHARGE / PROCESS_ASSOCIATE: single-store view ──
  const store = storeId
    ? await prisma.store.findUnique({
        where: { id: storeId },
        select: { name: true, attendanceMode: true },
      })
    : null;

  const storeScope = { storeId: storeId ?? '__none__' };
  const [activeEmployees, pendingForms, recent, manualToday] = await Promise.all([
    prisma.employee.count({ where: { status: 'ACTIVE', ...storeScope } }),
    can(session, 'formTracking:view', { storeId })
      ? prisma.employee.count({ where: { onboardingFormStatus: 'PENDING', ...storeScope } })
      : Promise.resolve(null),
    prisma.employee.findMany({
      where: storeScope,
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, name: true, staffCode: true },
    }),
    store?.attendanceMode === 'MANUAL'
      ? prisma.manualAttendanceEntry.count({
          where: {
            employee: storeScope,
            date: { gte: new Date(new Date().toDateString()) },
          },
        })
      : Promise.resolve(null),
  ]);

  return (
    <main className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          {greeting} {store ? `Overview for ${store.name}.` : ''}
        </p>
      </div>

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
        {manualToday !== null && (
          <StatCard
            label="Attendance marked today"
            value={`${manualToday} / ${activeEmployees}`}
            href="/attendance/manual"
            tone={manualToday < activeEmployees ? 'warning' : 'default'}
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recently onboarded</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <EmployeeList employees={recent} />
        </CardContent>
      </Card>
    </main>
  );
}
