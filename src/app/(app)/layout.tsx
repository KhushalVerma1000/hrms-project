import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { prisma } from '@/lib/prisma';
import { NavLink, type NavItem } from './nav-link';
import { MobileNav } from './mobile-nav';
import { LogoutButton } from './logout-button';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userRole = session.user.role;
  const canViewAttendance = can(session, 'attendance:view', {});
  const canManualAttendance = can(session, 'attendance:manualEntry', { storeId: session.user.storeId });
  const canViewReports = can(session, 'reports:view', {});
  // Face attendance is an opt-in module: only show it if at least one store in
  // the user's scope has it switched on.
  let canFaceAttendance = false;
  if (can(session, 'attendance:facePunch', { storeId: session.user.storeId })) {
    const scope =
      userRole === 'CLIENT'
        ? { clientId: session.user.clientId ?? '__none__' }
        : userRole === 'ADMIN'
        ? {}
        : { id: session.user.storeId ?? '__none__' };
    canFaceAttendance =
      (await prisma.store.count({
        where: { faceAttendanceEnabled: true, ...scope },
        take: 1,
      })) > 0;
  }
  const canCsvUpload = can(session, 'attendance:csvUpload', { storeId: session.user.storeId });
  const canManageDeadlines = can(session, 'attendance:deadlinePolicy:manage');
  const canManageStores = userRole === 'ADMIN' || userRole === 'CLIENT';
  const canManageDevices = can(session, 'device:manage', { clientId: session.user.clientId });
  const canManageUsers = can(session, 'user:manage', { storeId: session.user.storeId, clientId: session.user.clientId });
  const canViewSyncIssues = can(session, 'syncIssues:view', {});
  const canViewAuditLog = can(session, 'auditLog:view', {});
  const canManagePayroll = can(session, 'payroll:manage', {});
  const canReviewForms = can(session, 'formSubmissions:manage', {});

  const navItems: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: '📊' },
    ...(canViewAttendance ? [{ href: '/attendance', label: 'Attendance Logs', icon: '🕒' }] : []),
    ...(canManualAttendance ? [{ href: '/attendance/manual', label: 'Manual Attendance', icon: '📝' }] : []),
    ...(canViewReports ? [{ href: '/reports', label: 'Reports & Analytics', icon: '📈' }] : []),
    ...(canManagePayroll ? [{ href: '/payroll', label: 'Salary & Payroll', icon: '💰' }] : []),
    ...(canFaceAttendance ? [{ href: '/face-attendance', label: 'Face Attendance', icon: '📸' }] : []),
    ...(canCsvUpload ? [{ href: '/attendance/upload', label: 'Attendance Upload', icon: '📤' }] : []),
    ...(canManageDeadlines ? [{ href: '/attendance/deadlines', label: 'Attendance Deadlines', icon: '⏰' }] : []),
    { href: '/onboarding', label: 'Onboarding Wizard', icon: '✨' },
    { href: '/onboarding/pending-forms', label: 'Pending Forms', icon: '📋' },
    ...(canReviewForms ? [{ href: '/form-submissions', label: 'Form Submissions', icon: '📥' }] : []),
    { href: '/employees', label: 'Employee Directory', icon: '👥' },
    ...(canManageStores ? [{ href: '/stores', label: 'Stores & Brands', icon: '🏬' }] : []),
    ...(canManageDevices ? [{ href: '/devices', label: 'Biometric Devices', icon: '📱' }] : []),
    ...(canManageUsers ? [{ href: '/users', label: 'App Users & Roles', icon: '🛡️' }] : []),
    ...(canViewSyncIssues ? [{ href: '/sync-issues', label: 'SmartOffice Sync Issues', icon: '⚡' }] : []),
    ...(canViewAuditLog ? [{ href: '/audit-log', label: 'Audit Log', icon: '🧾' }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-64 min-h-screen bg-slate-900 border-r border-slate-800 hidden lg:flex flex-col">
          <div className="p-6 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center font-bold text-white shadow-md">
                WW
              </div>
              <div>
                <p className="text-sm font-bold text-white">Workforce Platform</p>
                <p className="text-xs text-blue-400 font-mono capitalize">
                  {userRole.toLowerCase().replace(/_/g, ' ')}
                </p>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-1.5">
            {navItems.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>

          <div className="p-4 border-t border-slate-800 bg-slate-950/40 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center font-bold text-xs text-primary">
                {session.user.name?.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white truncate">{session.user.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{session.user.email}</p>
              </div>
            </div>
            <LogoutButton />
          </div>
        </aside>

        <MobileNav
          navItems={navItems}
          userName={session.user.name ?? ''}
          userEmail={session.user.email ?? ''}
          userRole={userRole}
        />

        <main className="flex-1 min-w-0 overflow-auto bg-slate-50 dark:bg-slate-950">
          {children}
        </main>
      </div>
    </div>
  );
}
