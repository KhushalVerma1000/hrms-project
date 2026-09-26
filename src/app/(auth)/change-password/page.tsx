import type { Metadata } from 'next';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';

export const metadata: Metadata = {
  title: 'Change Password | HRMS Platform',
};

export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4">
      <div className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white mb-2">Set a new password</h1>
        <p className="text-slate-400 text-sm mb-6">
          {session.user.mustChangePassword
            ? 'Your account requires you to change your password before continuing.'
            : 'Update the password for your account.'}
        </p>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
