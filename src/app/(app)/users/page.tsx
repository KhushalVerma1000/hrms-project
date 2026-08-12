import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { UserManagement } from '@/components/users/UserManagement';

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <UserManagement currentUserRole={session.user.role} />
    </div>
  );
}
