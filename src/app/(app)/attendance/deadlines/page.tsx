import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { prisma } from '@/lib/prisma';
import { listPendingLateAccessRequests, listOvertimeDiscrepancies } from './actions';
import { AttendanceAdminPanel } from '@/components/attendance/AttendanceAdminPanel';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Attendance Deadlines & Reconciliation | HRMS Platform',
  description: 'Set upload deadlines, review late-access requests, and reconcile overtime discrepancies',
};

export default async function AttendanceDeadlinesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (!can(session, 'attendance:deadlinePolicy:manage')) {
    redirect('/dashboard');
  }

  const [clients, pendingRequests, discrepancies] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, shortName: true } }),
    listPendingLateAccessRequests(),
    listOvertimeDiscrepancies(),
  ]);

  return (
    <AttendanceAdminPanel
      clients={clients}
      pendingRequests={pendingRequests.map((r) => ({
        id: r.id,
        storeName: r.period.store.name,
        clientId: r.period.store.clientId,
        periodYear: r.period.periodYear,
        periodMonth: r.period.periodMonth,
        requestedByName: r.requestedByUser.name,
        requestedByEmail: r.requestedByUser.email,
        requestedAt: r.requestedAt.toISOString(),
        reason: r.reason,
      }))}
      discrepancies={discrepancies.map((d) => ({
        id: d.id,
        employeeName: d.employee.name,
        staffCode: d.employee.staffCode,
        periodYear: d.period.periodYear,
        periodMonth: d.period.periodMonth,
        totalHours: d.totalHours.toString(),
      }))}
    />
  );
}
