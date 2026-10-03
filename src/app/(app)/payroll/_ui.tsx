import type { ReactNode } from 'react';

export const inputCls =
  'h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900';
export const btnCls =
  'inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50';
export const btnGhostCls =
  'inline-flex h-9 items-center justify-center rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800';
export const btnDangerCls =
  'inline-flex h-9 items-center justify-center rounded-md border border-red-300 px-3 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400';
export const cardCls = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
      {label}
      {children}
      {hint ? <span className="font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Notice({ error, ok }: { error?: string; ok?: string }) {
  if (!error && !ok) return null;
  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        error ? 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
      }`}
    >
      {error ?? ok}
    </div>
  );
}

export const rupees = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-IN'));
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
