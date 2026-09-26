import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { SyncIssuesPanel } from '@/components/sync/SyncIssuesPanel';

export default async function SyncIssuesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }
  if (!can(session, 'syncIssues:view', {})) {
    redirect('/dashboard');
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <SyncIssuesPanel userRole={session.user.role} />
    </div>
  );
}
