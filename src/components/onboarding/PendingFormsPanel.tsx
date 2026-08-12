'use client';

import { useState, useTransition } from 'react';
import { ClipboardList, Send, Clock, AlertCircle, CheckCircle, Copy, Check } from 'lucide-react';
import { markFormSent, sendFormReminder } from '@/app/(app)/onboarding/pending-forms/actions';

interface Employee {
  id: string;
  staffCode: string;
  name: string;
  designation: string;
  dateOfJoining: Date | null;
  onboardingFormStatus: string;
  onboardingFormSentAt: Date | null;
  onboardingFormLastRemindedAt: Date | null;
  store: { name: string; client: { shortName: string } };
}

interface Props {
  employees: Employee[];
  summaryStats: { notSent: number; pending: number };
  submittedCount: number;
  canRemind: boolean;
}

function daysSince(date: Date | null): string {
  if (!date) return 'never';
  const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function FormStatusBadge({ status }: { status: string }) {
  if (status === 'NOT_SENT') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
        <AlertCircle className="w-3 h-3" /> Not Sent
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
}

function CopyLinkButton({ formLink }: { formLink: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!formLink) return;
    await navigator.clipboard.writeText(formLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!formLink) {
    return (
      <span className="text-xs text-slate-400">Form URL not configured</span>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors border border-blue-200 dark:border-blue-800"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied!' : 'Copy form link'}
    </button>
  );
}

function EmployeeRow({ employee, canRemind }: { employee: Employee; canRemind: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [formLink, setFormLink] = useState<string | null>(null);
  const [reminded, setReminded] = useState(false);

  async function handleRemind() {
    startTransition(async () => {
      const result = await sendFormReminder(employee.id);
      if (result.ok && result.formLink) {
        setFormLink(result.formLink);
        setReminded(true);
      }
    });
  }

  async function handleMarkSent() {
    startTransition(async () => {
      await markFormSent(employee.id);
    });
  }

  const daysSinceJoining = employee.dateOfJoining
    ? Math.floor((Date.now() - new Date(employee.dateOfJoining).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      <td className="px-4 py-3">
        <div>
          <p className="font-medium text-slate-900 dark:text-white text-sm">{employee.name}</p>
          <p className="text-xs text-slate-500 font-mono">{employee.staffCode}</p>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
        {employee.store.client.shortName} — {employee.store.name}
      </td>
      <td className="px-4 py-3 text-sm text-slate-500 capitalize">
        {employee.designation.replace('_', ' ').toLowerCase()}
      </td>
      <td className="px-4 py-3">
        <FormStatusBadge status={employee.onboardingFormStatus} />
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {daysSinceJoining !== null ? `${daysSinceJoining}d ago` : '—'}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {employee.onboardingFormLastRemindedAt
          ? daysSince(employee.onboardingFormLastRemindedAt)
          : 'Never'}
      </td>
      <td className="px-4 py-3">
        {canRemind && (
          <div className="flex items-center gap-2">
            {formLink ? (
              <CopyLinkButton formLink={formLink} />
            ) : (
              <button
                onClick={handleRemind}
                disabled={isPending}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
              >
                <Send className="w-3 h-3" />
                {reminded ? 'Get link' : 'Remind'}
              </button>
            )}
            {employee.onboardingFormStatus === 'NOT_SENT' && (
              <button
                onClick={handleMarkSent}
                disabled={isPending}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
              >
                Mark sent
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function PendingFormsPanel({ employees, summaryStats, submittedCount, canRemind }: Props) {
  const total = summaryStats.notSent + summaryStats.pending + submittedCount;
  const completionPct = total > 0 ? Math.round((submittedCount / total) * 100) : 0;

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-blue-600" />
          Pending Onboarding Forms
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Track which employees have completed their onboarding paperwork.
        </p>
      </div>

      {/* Funnel stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <p className="text-2xl font-bold text-slate-700 dark:text-slate-400">{summaryStats.notSent}</p>
          <p className="text-xs text-slate-500 mt-1">Not yet sent</p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-100 dark:border-amber-900 p-4">
          <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{summaryStats.pending}</p>
          <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">Awaiting submission</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-100 dark:border-emerald-900 p-4">
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{submittedCount}</p>
          <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">Submitted</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-100 dark:border-blue-900 p-4">
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{completionPct}%</p>
          <p className="text-xs text-blue-600 dark:text-blue-500 mt-1">Completion rate</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex justify-between text-xs text-slate-500 mb-2">
          <span>Form completion progress</span>
          <span>{submittedCount} of {total}</span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2">
          <div
            className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>

      {/* Pending employees table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2 className="font-medium text-slate-900 dark:text-white text-sm">
            Employees with pending forms ({employees.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Store</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Designation</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Joined</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Last Reminded</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                    <p className="text-slate-500 text-sm">All employees have submitted their onboarding forms!</p>
                  </td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <EmployeeRow key={emp.id} employee={emp} canRemind={canRemind} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
