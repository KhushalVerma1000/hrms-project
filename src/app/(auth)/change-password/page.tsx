import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Change Password | HRMS Platform',
};

export default function ChangePasswordPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4">
      <div className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white mb-2">Set a new password</h1>
        <p className="text-slate-400 text-sm mb-6">
          Your account requires you to change your password before continuing.
        </p>
        <p className="text-slate-500 text-sm text-center">
          Change password form — contact your administrator to reset manually.
        </p>
      </div>
    </main>
  );
}
