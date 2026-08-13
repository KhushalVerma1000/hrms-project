import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { prisma } from '@/lib/prisma';
import { ManualAttendanceForm } from '@/components/attendance/ManualAttendanceForm';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Manual Attendance | HRMS Platform',
  description: 'Record daily attendance for stores without a biometric device',
};

interface PageProps {
  searchParams: Promise<{ storeId?: string; date?: string }>;
}

export default async function ManualAttendancePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (!can(session, 'attendance:manualEntry', { storeId: session.user.storeId })) {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const role = session.user.role;

  // Scope the list of MANUAL-mode stores this user can record attendance for.
  const stores = await prisma.store.findMany({
    where: {
      attendanceMode: 'MANUAL',
      ...(role === 'MANAGER' || role === 'SHIFT_INCHARGE'
        ? { id: session.user.storeId ?? undefined }
        : role === 'CLIENT'
        ? { clientId: session.user.clientId ?? undefined }
        : {}),
    },
    select: { id: true, name: true, client: { select: { shortName: true } } },
    orderBy: { name: 'asc' },
  });

  if (stores.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p>No stores in your scope are set to Manual attendance mode.</p>
        <p className="text-sm mt-1">
          A store&apos;s attendance mode is set when it&apos;s created (or edited) by Admin/Client.
        </p>
      </div>
    );
  }

  const selectedStoreId = params.storeId || stores[0]!.id;
  const selectedDate = params.date || new Date().toISOString().split('T')[0]!;

  return (
    <ManualAttendanceForm
      stores={stores}
      selectedStoreId={selectedStoreId}
      selectedDate={selectedDate}
    />
  );
}
