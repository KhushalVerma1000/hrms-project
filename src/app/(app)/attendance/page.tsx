import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { prisma } from '@/lib/prisma';
import { AttendanceDashboard } from '@/components/attendance/AttendanceDashboard';
import type { Metadata } from 'next';
import { SMARTOFFICE_TIMEZONE } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Attendance | HRMS Platform',
  description: 'Attendance logs and daily summaries',
};

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    storeId?: string;
    employeeCode?: string;
    direction?: string;
  }>;
}

export default async function AttendancePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (!can(session, 'attendance:view', {})) {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = now;

  const fromDate = params.from ? new Date(params.from) : defaultFrom;
  const toDate = params.to ? new Date(params.to) : defaultTo;

  const role = session.user.role;
  const sessionStoreId = session.user.storeId;
  const sessionClientId = session.user.clientId;

  const scopeFilter =
    role === 'MANAGER'
      ? { store: { id: sessionStoreId ?? undefined } }
      : role === 'CLIENT'
      ? { store: { clientId: sessionClientId ?? undefined } }
      : {};

  const stores = await prisma.store.findMany({
    where:
      role === 'MANAGER'
        ? { id: sessionStoreId ?? undefined }
        : role === 'CLIENT'
        ? { clientId: sessionClientId ?? undefined }
        : {},
    select: { id: true, name: true, client: { select: { shortName: true } } },
    orderBy: { name: 'asc' },
  });

  const storeIdFilter = params.storeId
    ? { store: { id: params.storeId } }
    : scopeFilter;

  const employees = await prisma.employee.findMany({
    where: {
      ...storeIdFilter,
      ...(params.employeeCode ? { staffCode: { contains: params.employeeCode, mode: 'insensitive' } } : {}),
    },
    select: { staffCode: true, name: true, storeId: true, designation: true },
  });

  const employeeCodes = employees.map((e) => e.staffCode);

  const logs = await prisma.attendanceLog.findMany({
    where: {
      employeeCode: { in: employeeCodes },
      logDate: { gte: fromDate, lte: toDate },
      ...(params.direction ? { punchDirection: params.direction } : {}),
    },
    orderBy: [{ employeeCode: 'asc' }, { logDate: 'asc' }],
  });

  const employeeMap = new Map(employees.map((e) => [e.staffCode, e]));

  interface DaySummary {
    employeeCode: string;
    employeeName: string;
    date: string;
    firstIn: Date | null;
    lastOut: Date | null;
    totalPunches: number;
    totalHoursMinutes: string;
  }

  const summaryMap = new Map<string, DaySummary>();

  for (const log of logs) {
    const dateKey = log.logDate
      .toLocaleDateString('en-CA', { timeZone: SMARTOFFICE_TIMEZONE });
    const key = `${log.employeeCode}|${dateKey}`;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        employeeCode: log.employeeCode,
        employeeName: employeeMap.get(log.employeeCode)?.name ?? log.employeeCode,
        date: dateKey,
        firstIn: null,
        lastOut: null,
        totalPunches: 0,
        totalHoursMinutes: '',
      });
    }

    const summary = summaryMap.get(key)!;
    summary.totalPunches++;

    if (!summary.firstIn || log.logDate < summary.firstIn) {
      summary.firstIn = log.logDate;
    }
    if (!summary.lastOut || log.logDate > summary.lastOut) {
      summary.lastOut = log.logDate;
    }
  }

  for (const summary of summaryMap.values()) {
    if (summary.firstIn && summary.lastOut && summary.firstIn !== summary.lastOut) {
      const diffMs = summary.lastOut.getTime() - summary.firstIn.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      summary.totalHoursMinutes = `${hours}h ${minutes}m`;
    } else {
      summary.totalHoursMinutes = '—';
    }
  }

  const summaries = Array.from(summaryMap.values()).sort(
    (a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName),
  );

  return (
    <AttendanceDashboard
      summaries={summaries}
      stores={stores}
      fromDate={fromDate.toISOString().split('T')[0]!}
      toDate={toDate.toISOString().split('T')[0]!}
      selectedStoreId={params.storeId}
      selectedDirection={params.direction}
      timezone={SMARTOFFICE_TIMEZONE}
    />
  );
}
