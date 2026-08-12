import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { DeviceManagement } from '@/components/devices/DeviceManagement';

export default async function DevicesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <DeviceManagement userRole={session.user.role} />
    </div>
  );
}
