'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  ClipboardList,
  Clock,
  AlertCircle,
  CheckCircle,
  Copy,
  MessageCircle,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Phone,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { markFormSent, sendFormReminder, markFormSubmittedManually } from '@/app/(app)/onboarding/pending-forms/actions';
import { updateEmployeeMobileAction } from '@/app/(app)/employees/actions';
import { formatMobile, normalizeMobile } from '@/lib/whatsapp';

interface Employee {
  id: string;
  staffCode: string;
  name: string;
  designation: string;
  mobileNumber: string | null;
  dateOfJoining: Date | null;
  onboardingFormStatus: string;
  onboardingFormSentAt: Date | null;
  onboardingFormLastRemindedAt: Date | null;
  storeId: string;
  store: { name: string; clientId: string; client: { shortName: string } };
}

interface Props {
  employees: Employee[];
  summaryStats: { notSent: number; pending: number };
  submittedCount: number;
  canRemind: boolean;
}

type StatusTab = 'ALL' | 'NOT_SENT' | 'PENDING';
type SortKey = 'OLDEST_JOINED' | 'NEWEST_JOINED' | 'LONGEST_SINCE_REMINDER' | 'NAME';

/** A form still outstanding this many days after joining is flagged as overdue. */
const OVERDUE_AFTER_DAYS = 3;
const PAGE_SIZE = 25;

const DESIGNATION_LABELS: Record<string, string> = {
  ASSOCIATE: 'Associate',
  PROCESS_ASSOCIATE: 'Process Associate',
  QUALITY_ASSOCIATE: 'Quality Associate',
  SHIFT_INCHARGE: 'Shift Incharge',
  STORE_MANAGER: 'Store Manager',
  HOUSEKEEPING: 'Housekeeping',
  OTHER: 'Other',
};

function daysBetween(date: Date | string | null): number | null {
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));
}

function ago(date: Date | string | null): string {
  const d = daysBetween(date);
  if (d === null) return 'never';
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

function FormStatusBadge({ status }: { status: string }) {
  if (status === 'NOT_SENT') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
        <AlertCircle className="w-3 h-3" /> Not sent
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
      <Clock className="w-3 h-3" /> Awaiting
    </span>
  );
}

/** Inline "add a mobile number" so a missing number never blocks sending. */
function AddMobile({ employeeId, onSaved }: { employeeId: string; onSaved: (mobile: string) => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const invalid = value.trim() !== '' && normalizeMobile(value) === null;

  async function save() {
    if (!value.trim() || invalid) return;
    setSaving(true);
    try {
      const res = await updateEmployeeMobileAction(employeeId, value);
      if (res.ok && res.mobileNumber) {
        onSaved(res.mobileNumber);
        toast.success('Mobile number saved');
      } else {
        toast.error(res.error || 'Could not save the number');
      }
    } catch (e: any) {
      toast.error(e.message || 'Could not save the number');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="tel"
        inputMode="tel"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="Add mobile number"
        aria-label="Mobile number"
        aria-invalid={invalid}
        className={`w-36 rounded-md border px-2 py-1 text-xs bg-white dark:bg-slate-900 ${
          invalid ? 'border-red-400' : 'border-slate-300 dark:border-slate-600'
        }`}
      />
      <button
        onClick={save}
        disabled={saving || !value.trim() || invalid}
        className="rounded-md bg-slate-800 dark:bg-slate-200 px-2 py-1 text-xs font-medium text-white dark:text-slate-900 disabled:opacity-40"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
      </button>
    </div>
  );
}

function EmployeeRow({
  employee,
  canRemind,
  onChange,
  onSubmitted,
}: {
  employee: Employee;
  canRemind: boolean;
  onChange: (patch: Partial<Employee>) => void;
  onSubmitted: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  const notSent = employee.onboardingFormStatus === 'NOT_SENT';
  const daysSinceJoining = daysBetween(employee.dateOfJoining);
  const overdue = daysSinceJoining !== null && daysSinceJoining >= OVERDUE_AFTER_DAYS;

  /** Records the send/reminder on the server, then applies it to the row immediately. */
  async function record() {
    const result = notSent ? await markFormSent(employee.id) : await sendFormReminder(employee.id);
    if (result.ok) {
      const now = new Date();
      onChange({
        onboardingFormStatus: 'PENDING',
        onboardingFormSentAt: employee.onboardingFormSentAt ?? now,
        onboardingFormLastRemindedAt: now,
      });
    }
    return result;
  }

  function handleWhatsApp() {
    // Open synchronously (inside the click) so popup blockers allow it.
    const win = window.open('', '_blank');
    startTransition(async () => {
      const result = await record();
      if (result.ok && result.whatsappUrl && win) {
        win.location.href = result.whatsappUrl;
        toast.success(`${notSent ? 'Form link' : 'Reminder'} ready in WhatsApp for ${employee.name}`);
      } else {
        win?.close();
        toast.error(
          result.ok ? 'No onboarding form is configured for this store yet.' : 'Could not prepare the message.',
        );
      }
    });
  }

  function handleCopy() {
    startTransition(async () => {
      const result = await record();
      if (result.ok && result.formLink) {
        await navigator.clipboard.writeText(result.formLink);
        toast.success('Form link copied');
      } else {
        toast.error(result.ok ? 'No onboarding form is configured for this store yet.' : 'Could not get the link.');
      }
    });
  }

  function handleMarkSent() {
    startTransition(async () => {
      const result = await markFormSent(employee.id);
      if (result.ok) {
        const now = new Date();
        onChange({ onboardingFormStatus: 'PENDING', onboardingFormSentAt: now, onboardingFormLastRemindedAt: now });
        toast.success('Marked as sent');
      }
    });
  }

  function handleMarkSubmitted() {
    if (!window.confirm(`Mark ${employee.name}'s form as submitted? Use this only if they really completed it.`)) return;
    startTransition(async () => {
      const result = await markFormSubmittedManually(employee.id);
      if (result.ok) {
        toast.success(`${employee.name} marked as submitted`);
        onSubmitted();
      } else {
        toast.error(result.error || 'Could not update');
      }
    });
  }

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors align-top">
      <td className="px-4 py-3">
        <p className="font-medium text-slate-900 dark:text-white text-sm">{employee.name}</p>
        <p className="text-xs text-slate-500">
          <span className="font-mono">{employee.staffCode}</span> &bull;{' '}
          {DESIGNATION_LABELS[employee.designation] ?? employee.designation}
        </p>
      </td>
      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
        <p>{employee.store.name}</p>
        <p className="text-xs text-slate-500">{employee.store.client.shortName}</p>
      </td>
      <td className="px-4 py-3 text-sm">
        {employee.mobileNumber ? (
          <span className="inline-flex items-center gap-1 tabular-nums text-slate-700 dark:text-slate-200">
            <Phone className="w-3 h-3 text-slate-400" /> {formatMobile(employee.mobileNumber)}
          </span>
        ) : canRemind ? (
          <AddMobile employeeId={employee.id} onSaved={(m) => onChange({ mobileNumber: m })} />
        ) : (
          <span className="text-xs text-slate-400">No number</span>
        )}
      </td>
      <td className="px-4 py-3">
        <FormStatusBadge status={employee.onboardingFormStatus} />
        {overdue && (
          <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
            Overdue &bull; joined {daysSinceJoining}d ago
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500 space-y-0.5">
        {!overdue && <p>Joined {ago(employee.dateOfJoining)}</p>}
        <p>Sent {employee.onboardingFormSentAt ? ago(employee.onboardingFormSentAt) : 'never'}</p>
        <p>Reminded {ago(employee.onboardingFormLastRemindedAt)}</p>
      </td>
      <td className="px-4 py-3">
        {canRemind && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleWhatsApp}
              disabled={isPending || !employee.mobileNumber}
              title={employee.mobileNumber ? undefined : 'Add a mobile number first'}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageCircle className="w-3 h-3" />}
              {notSent ? 'Send on WhatsApp' : 'Remind'}
            </button>
            <button
              onClick={handleCopy}
              disabled={isPending}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 disabled:opacity-40 transition-colors"
            >
              <Copy className="w-3 h-3" /> Copy link
            </button>
            <button
              onClick={handleMarkSubmitted}
              disabled={isPending}
              className="text-xs text-slate-500 hover:text-emerald-700 underline disabled:opacity-40"
              title="Use if they completed the form but it didn't register here"
            >
              Mark submitted
            </button>
            {notSent && (
              <button
                onClick={handleMarkSent}
                disabled={isPending}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline disabled:opacity-40"
                title="Use if you already sent the form outside this app"
              >
                Already sent
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function PendingFormsPanel({ employees: initial, summaryStats, submittedCount, canRemind }: Props) {
  // Local copy so actions update the row immediately, without a full page reload.
  const [rows, setRows] = useState<Employee[]>(initial);
  const [tab, setTab] = useState<StatusTab>('ALL');
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('ALL');
  const [storeFilter, setStoreFilter] = useState('ALL');
  const [sort, setSort] = useState<SortKey>('OLDEST_JOINED');
  const [page, setPage] = useState(1);
  const [newlySubmitted, setNewlySubmitted] = useState(0);

  const patchRow = (id: string, patch: Partial<Employee>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Counts follow the live rows, so they stay right after "Send"/"Already sent".
  const notSent = rows.filter((r) => r.onboardingFormStatus === 'NOT_SENT').length;
  const awaiting = rows.length - notSent;
  const submitted = submittedCount + newlySubmitted;
  const total = rows.length + submitted;
  const completionPct = total > 0 ? Math.round((submitted / total) * 100) : 0;

  const clients = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => m.set(r.store.clientId, r.store.client.shortName));
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);
  const stores = useMemo(() => {
    const m = new Map<string, { name: string; clientId: string }>();
    rows.forEach((r) => m.set(r.storeId, { name: r.store.name, clientId: r.store.clientId }));
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .filter((s) => clientFilter === 'ALL' || s.clientId === clientFilter)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, clientFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    const out = rows.filter((r) => {
      if (tab === 'NOT_SENT' && r.onboardingFormStatus !== 'NOT_SENT') return false;
      if (tab === 'PENDING' && r.onboardingFormStatus === 'NOT_SENT') return false;
      if (clientFilter !== 'ALL' && r.store.clientId !== clientFilter) return false;
      if (storeFilter !== 'ALL' && r.storeId !== storeFilter) return false;
      if (q) {
        const hit =
          r.name.toLowerCase().includes(q) ||
          r.staffCode.toLowerCase().includes(q) ||
          (digits.length >= 4 && !!r.mobileNumber && r.mobileNumber.includes(digits));
        if (!hit) return false;
      }
      return true;
    });
    const joined = (r: Employee) => (r.dateOfJoining ? new Date(r.dateOfJoining).getTime() : Infinity);
    const reminded = (r: Employee) =>
      r.onboardingFormLastRemindedAt ? new Date(r.onboardingFormLastRemindedAt).getTime() : -Infinity;
    out.sort((a, b) =>
      sort === 'OLDEST_JOINED'
        ? joined(a) - joined(b)
        : sort === 'NEWEST_JOINED'
        ? joined(b) - joined(a)
        : sort === 'LONGEST_SINCE_REMINDER'
        ? reminded(a) - reminded(b)
        : a.name.localeCompare(b.name),
    );
    return out;
  }, [rows, tab, search, clientFilter, storeFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filtersActive = tab !== 'ALL' || !!search || clientFilter !== 'ALL' || storeFilter !== 'ALL';
  const overdueCount = rows.filter((r) => (daysBetween(r.dateOfJoining) ?? 0) >= OVERDUE_AFTER_DAYS).length;

  const resetFilters = () => {
    setTab('ALL');
    setSearch('');
    setClientFilter('ALL');
    setStoreFilter('ALL');
    setPage(1);
  };

  const selectCls =
    'rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-sm';

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-blue-600" />
          Pending Onboarding Forms
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Send each new joiner their form on WhatsApp and see who still hasn&apos;t completed it.
        </p>
      </div>

      {/* Funnel stats — the first three double as quick filters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <button
          onClick={() => { setTab('NOT_SENT'); setPage(1); }}
          className={`text-left bg-white dark:bg-slate-800 rounded-xl border p-4 transition-shadow hover:shadow-sm ${
            tab === 'NOT_SENT' ? 'border-slate-500 ring-1 ring-slate-400' : 'border-slate-200 dark:border-slate-700'
          }`}
        >
          <p className="text-2xl font-bold text-slate-700 dark:text-slate-300">{notSent}</p>
          <p className="text-xs text-slate-500 mt-1">Not yet sent</p>
        </button>
        <button
          onClick={() => { setTab('PENDING'); setPage(1); }}
          className={`text-left bg-amber-50 dark:bg-amber-950/30 rounded-xl border p-4 transition-shadow hover:shadow-sm ${
            tab === 'PENDING' ? 'border-amber-500 ring-1 ring-amber-400' : 'border-amber-100 dark:border-amber-900'
          }`}
        >
          <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{awaiting}</p>
          <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">Awaiting submission</p>
        </button>
        <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-100 dark:border-emerald-900 p-4">
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{submitted}</p>
          <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">Submitted</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-100 dark:border-blue-900 p-4">
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{completionPct}%</p>
          <p className="text-xs text-blue-600 dark:text-blue-500 mt-1">
            Completion &bull; {submitted} of {total}
          </p>
          <div className="mt-2 w-full bg-blue-100 dark:bg-blue-900/50 rounded-full h-1.5">
            <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${completionPct}%` }} />
          </div>
        </div>
      </div>

      {overdueCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 px-3 py-2 text-sm text-red-800 dark:text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {overdueCount} {overdueCount === 1 ? 'form is' : 'forms are'} still outstanding {OVERDUE_AFTER_DAYS}+ days after joining — they&apos;re listed first.
        </div>
      )}

      {/* List */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search name, e-code or mobile..."
                aria-label="Search pending forms"
                className={`${selectCls} w-full pl-8 pr-8`}
              />
              {search && (
                <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {clients.length > 1 && (
              <select
                value={clientFilter}
                onChange={(e) => { setClientFilter(e.target.value); setStoreFilter('ALL'); setPage(1); }}
                aria-label="Filter by client"
                className={selectCls}
              >
                <option value="ALL">All clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {stores.length > 1 && (
              <select
                value={storeFilter}
                onChange={(e) => { setStoreFilter(e.target.value); setPage(1); }}
                aria-label="Filter by store"
                className={selectCls}
              >
                <option value="ALL">All stores</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort" className={selectCls}>
              <option value="OLDEST_JOINED">Sort: Longest waiting</option>
              <option value="NEWEST_JOINED">Sort: Newest joiners</option>
              <option value="LONGEST_SINCE_REMINDER">Sort: Longest since reminder</option>
              <option value="NAME">Sort: Name A–Z</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-900 p-0.5 text-sm" role="tablist">
              {([
                ['ALL', `All (${rows.length})`],
                ['NOT_SENT', `Not sent (${notSent})`],
                ['PENDING', `Awaiting (${awaiting})`],
              ] as [StatusTab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => { setTab(key); setPage(1); }}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    tab === key
                      ? 'bg-white dark:bg-slate-700 shadow-sm font-medium text-slate-900 dark:text-white'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {filtersActive && (
              <button onClick={resetFilters} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                <X className="w-3.5 h-3.5" /> Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                {['Employee', 'Store', 'Mobile', 'Status', 'Timeline', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                    <p className="text-slate-600 dark:text-slate-300 text-sm font-medium">
                      {rows.length === 0 ? 'All employees have submitted their onboarding forms!' : 'Nothing matches these filters.'}
                    </p>
                    {filtersActive && rows.length > 0 && (
                      <button onClick={resetFilters} className="mt-2 text-sm text-blue-600 underline">Clear filters</button>
                    )}
                  </td>
                </tr>
              ) : (
                pageRows.map((emp) => (
                  <EmployeeRow
                    key={emp.id}
                    employee={emp}
                    canRemind={canRemind}
                    onChange={(patch) => patchRow(emp.id, patch)}
                    onSubmitted={() => {
                      setRows((rs) => rs.filter((r) => r.id !== emp.id));
                      setNewlySubmitted((n) => n + 1);
                    }}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-3 text-sm">
            <span className="text-slate-500">
              {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous page" className="rounded-md border border-slate-300 dark:border-slate-600 p-1 disabled:opacity-40">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">Page {currentPage} of {totalPages}</span>
              <button onClick={() => setPage(currentPage + 1)} disabled={currentPage >= totalPages} aria-label="Next page" className="rounded-md border border-slate-300 dark:border-slate-600 p-1 disabled:opacity-40">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
