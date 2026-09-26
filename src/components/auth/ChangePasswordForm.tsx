'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { changePasswordAction } from '@/app/(auth)/change-password/actions';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

export function ChangePasswordForm() {
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
  });

  async function onSubmit(data: ChangePasswordFormData) {
    setFormError(null);
    const result = await changePasswordAction({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
    });

    if (!result.ok) {
      setFormError(result.error || 'Failed to change password.');
      return;
    }

    toast.success('Password changed. Please sign in again.');
    await signOut({ callbackUrl: '/login' });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div>
        <label htmlFor="currentPassword" className="block text-sm font-medium text-slate-300 mb-1.5">
          Current password
        </label>
        <div className="relative">
          <input
            id="currentPassword"
            type={showCurrent ? 'text' : 'password'}
            autoComplete="current-password"
            className="w-full px-4 py-2.5 pr-11 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            placeholder="••••••••"
            {...register('currentPassword')}
          />
          <button
            type="button"
            onClick={() => setShowCurrent((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
            aria-label={showCurrent ? 'Hide password' : 'Show password'}
          >
            {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {errors.currentPassword && (
          <p className="mt-1.5 text-xs text-red-400">{errors.currentPassword.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="newPassword" className="block text-sm font-medium text-slate-300 mb-1.5">
          New password
        </label>
        <div className="relative">
          <input
            id="newPassword"
            type={showNew ? 'text' : 'password'}
            autoComplete="new-password"
            className="w-full px-4 py-2.5 pr-11 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            placeholder="••••••••"
            {...register('newPassword')}
          />
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
            aria-label={showNew ? 'Hide password' : 'Show password'}
          >
            {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {errors.newPassword && (
          <p className="mt-1.5 text-xs text-red-400">{errors.newPassword.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300 mb-1.5">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          type={showNew ? 'text' : 'password'}
          autoComplete="new-password"
          className="w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          placeholder="••••••••"
          {...register('confirmPassword')}
        />
        {errors.confirmPassword && (
          <p className="mt-1.5 text-xs text-red-400">{errors.confirmPassword.message}</p>
        )}
      </div>

      {formError && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <p className="text-sm text-red-400">{formError}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold transition-all shadow-lg shadow-blue-500/20"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Updating...
          </>
        ) : (
          <>
            <KeyRound className="w-4 h-4" />
            Change password
          </>
        )}
      </button>
    </form>
  );
}
