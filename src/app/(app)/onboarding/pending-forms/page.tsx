import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { prisma } from '@/lib/prisma';
import { PendingFormsPanel } from '@/components/onboarding/PendingFormsPanel';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pending Onboarding Forms | HRMS Platform',
};

export default async function PendingFormsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (!can(session, 'formTracking:view', {})) redirect('/dashboard');

  const role = session.user.role;
  const storeId = session.user.storeId;
  const clientId = session.user.clientId;

  const whereFilter =
    role === 'MANAGER' || role === 'SHIFT_INCHARGE'
      ? { storeId: storeId ?? undefined }
      : role === 'CLIENT'
      ? { store: { clientId: clientId ?? undefined } }
      : {};

  const pendingEmployees = await prisma.employee.findMany({
    where: {
      ...whereFilter,
      onboardingFormStatus: { not: 'SUBMITTED' },
      status: 'ACTIVE',
    },
    select: {
      id: true,
      staffCode: true,
      name: true,
      designation: true,
      dateOfJoining: true,
      onboardingFormStatus: true,
      onboardingFormSentAt: true,
      onboardingFormLastRemindedAt: true,
      store: { select: { name: true, client: { select: { shortName: true } } } },
    },
    orderBy: { dateOfJoining: 'asc' },
  });

  const summaryStats = {
    notSent: pendingEmployees.filter((e) => e.onboardingFormStatus === 'NOT_SENT').length,
    pending: pendingEmployees.filter((e) => e.onboardingFormStatus === 'PENDING').length,
  };

  // Get total submitted for funnel view
  const submittedCount = await prisma.employee.count({
    where: { ...whereFilter, onboardingFormStatus: 'SUBMITTED', status: 'ACTIVE' },
  });

  return (
    <PendingFormsPanel
      employees={pendingEmployees}
      summaryStats={summaryStats}
      submittedCount={submittedCount}
      canRemind={can(session, 'formTracking:remind', { storeId: storeId ?? undefined })}
    />
  );
}
