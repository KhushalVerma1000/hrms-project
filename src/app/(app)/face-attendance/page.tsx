import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { prisma } from '@/lib/prisma';
import { FaceAttendanceLoader } from '@/components/attendance/FaceAttendanceLoader';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Face Attendance | HRMS Platform',
  description: 'Mark attendance by scanning faces on your phone',
};

export default async function FaceAttendancePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (!can(session, 'attendance:facePunch', { storeId: session.user.storeId })) {
    redirect('/dashboard');
  }

  const role = session.user.role;

  // Only MANUAL-mode stores in the caller's scope — face scans write manual attendance rows.
  const stores = await prisma.store.findMany({
    where: {
      attendanceMode: 'MANUAL',
      ...(role === 'MANAGER' || role === 'SHIFT_INCHARGE' || role === 'PROCESS_ASSOCIATE'
        ? { id: session.user.storeId ?? '__none__' }
        : role === 'CLIENT'
        ? { clientId: session.user.clientId ?? '__none__' }
        : {}),
    },
    select: { id: true, name: true, client: { select: { shortName: true } } },
    orderBy: { name: 'asc' },
  });

  if (stores.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p>No stores in your scope are set to Manual attendance mode.</p>
        <p className="text-sm mt-1">Face scanning works for Manual-mode stores only.</p>
      </div>
    );
  }

  return <FaceAttendanceLoader stores={stores} />;
}
