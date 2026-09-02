import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { getUploadEligibleStores } from './actions';
import { AttendanceUploadForm } from '@/components/attendance/AttendanceUploadForm';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Attendance Upload | HRMS Platform',
  description: 'Download the attendance sheet, mark it up, and upload it back before the monthly deadline',
};

interface PageProps {
  searchParams: Promise<{ storeId?: string; year?: string; month?: string }>;
}

export default async function AttendanceUploadPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (!can(session, 'attendance:csvUpload', { storeId: session.user.storeId })) {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const stores = await getUploadEligibleStores();

  if (stores.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p>No stores are in your scope for attendance upload.</p>
      </div>
    );
  }

  const now = new Date();
  const selectedStoreId = params.storeId || stores[0]!.id;
  const selectedYear = Number(params.year) || now.getFullYear();
  const selectedMonth = Number(params.month) || now.getMonth() + 1;

  return (
    <AttendanceUploadForm
      stores={stores}
      selectedStoreId={selectedStoreId}
      selectedYear={selectedYear}
      selectedMonth={selectedMonth}
    />
  );
}
