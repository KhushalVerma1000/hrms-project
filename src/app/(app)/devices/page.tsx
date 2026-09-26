import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { DeviceManagement } from '@/components/devices/DeviceManagement';

export default async function DevicesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }
  if (!can(session, 'device:manage', { clientId: session.user.clientId })) {
    redirect('/dashboard');
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <DeviceManagement userRole={session.user.role} />
    </div>
  );
}
