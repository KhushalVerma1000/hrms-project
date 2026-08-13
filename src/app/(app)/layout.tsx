import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';

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
  const canManageStores = userRole === 'ADMIN' || userRole === 'CLIENT';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="flex min-h-screen">
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
            <NavLink href="/dashboard" label="Dashboard" icon="📊" />
            
            {canViewAttendance && (
              <NavLink href="/attendance" label="Attendance Logs" icon="🕒" />
            )}

            {canManualAttendance && (
              <NavLink href="/attendance/manual" label="Manual Attendance" icon="📝" />
            )}

            <NavLink href="/onboarding" label="Onboarding Wizard" icon="✨" />
            <NavLink href="/onboarding/pending-forms" label="Pending Forms" icon="📋" />
            <NavLink href="/employees" label="Employee Directory" icon="👥" />

            {canManageStores && (
              <NavLink href="/stores" label="Stores & Brands" icon="🏬" />
            )}

            <NavLink href="/devices" label="Biometric Devices" icon="📱" />
            <NavLink href="/users" label="App Users & Roles" icon="🛡️" />
            <NavLink href="/sync-issues" label="SmartOffice Sync Issues" icon="⚡" />
          </nav>

          <div className="p-4 border-t border-slate-800 bg-slate-950/40">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center font-bold text-xs text-primary">
                {session.user.name?.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white truncate">{session.user.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{session.user.email}</p>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-all text-sm font-medium"
    >
      <span className="text-base">{icon}</span>
      <span>{label}</span>
    </a>
  );
}
