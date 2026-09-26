import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { UserManagement } from '@/components/users/UserManagement';

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }
  if (!can(session, 'user:manage', { storeId: session.user.storeId, clientId: session.user.clientId })) {
    redirect('/dashboard');
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <UserManagement currentUserRole={session.user.role} />
    </div>
  );
}
