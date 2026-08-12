import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { StoreManagement } from '@/components/stores/StoreManagement';

export default async function StoresPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <StoreManagement userRole={session.user.role} />
    </div>
  );
}
