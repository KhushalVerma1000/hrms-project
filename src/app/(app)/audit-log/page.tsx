import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { AuditLogDashboard } from '@/components/audit/AuditLogDashboard';

export const metadata = { title: 'Audit Log | HRMS Platform' };

export default async function AuditLogPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session, 'auditLog:view')) redirect('/dashboard');

  return (
    <div className="container mx-auto py-6 px-4">
      <AuditLogDashboard isAdmin={session.user.role === 'ADMIN'} />
    </div>
  );
}
