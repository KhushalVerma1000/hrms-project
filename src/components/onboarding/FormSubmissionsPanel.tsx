'use client';

import { useCallback, useEffect, useState } from 'react';
import { Inbox, Search, Loader2, CheckCircle2, Trash2, Link2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  listUnmatchedSubmissionsAction,
  searchEmployeesForAssignAction,
  assignSubmissionAction,
  dismissSubmissionAction,
  type UnmatchedSubmissionRow,
} from '@/app/(app)/form-submissions/actions';

type Candidate = Awaited<ReturnType<typeof searchEmployeesForAssignAction>>[number];

function fmt(d: Date | string) {
  return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function reasonFor(row: UnmatchedSubmissionRow) {
  return row.staffCodeGuess
    ? `No employee has the code “${row.staffCodeGuess}”`
    : 'The submission had no employee code';
}

function SubmissionCard({ row, onResolved }: { row: UnmatchedSubmissionRow; onResolved: () => void }) {
  const [query, setQuery] = useState(row.staffCodeGuess ?? '');
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  const search = useCallback(async (q: string) => {
    setSearching(true);
    try {
      setResults(await searchEmployeesForAssignAction(q));
    } catch (e: any) {
      toast.error(e.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  }, []);

  // A near-miss code (typo, stray character) often still finds the right person.
  useEffect(() => {
    if (row.staffCodeGuess && row.staffCodeGuess.length >= 4) search(row.staffCodeGuess);
  }, [row.staffCodeGuess, search]);

  async function assign(c: Candidate) {
    if (!window.confirm(`Mark ${c.name} (${c.staffCode}) as having submitted their form?`)) return;
    setBusy(true);
    try {
      const res = await assignSubmissionAction(row.id, c.id);
      if (res.ok) {
        toast.success(`Linked to ${res.employeeName}`);
        onResolved();
      } else toast.error(res.error || 'Could not link');
    } catch (e: any) {
      toast.error(e.message || 'Could not link');
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!window.confirm('Dismiss this submission? It will move to Resolved and no employee is changed.')) return;
    setBusy(true);
    try {
      const res = await dismissSubmissionAction(row.id);
      if (res.ok) {
        toast.success('Dismissed');
        onResolved();
      } else toast.error(res.error || 'Could not dismiss');
    } catch (e: any) {
      toast.error(e.message || 'Could not dismiss');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">Unmatched</Badge>
            <span className="text-xs text-gray-500">{fmt(row.submittedAt)}</span>
            {row.formId && (
              <span className="text-xs text-gray-400 font-mono truncate max-w-[180px]" title={`Form ${row.formId}`}>
                form …{row.formId.slice(-8)}
              </span>
            )}
          </div>
          <p className="text-sm font-medium">{reasonFor(row)}</p>
          {row.answers.length > 0 ? (
            <dl className="text-xs space-y-1 rounded-md bg-gray-50 dark:bg-gray-900 border p-3 max-h-48 overflow-auto">
              {row.answers.map((a, i) => (
                <div key={i} className="grid grid-cols-[40%_1fr] gap-2">
                  <dt className="text-gray-500 truncate" title={a.question}>{a.question}</dt>
                  <dd className="break-words">{a.answer}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-gray-400">No answers were included.</p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Link to an employee</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(query);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, e-code or mobile"
                aria-label="Find employee"
                className="pl-8 text-sm"
              />
            </div>
            <Button type="submit" variant="secondary" disabled={searching || query.trim().length < 2}>
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Find'}
            </Button>
          </form>

          {results && results.length === 0 && <p className="text-xs text-gray-500">No employees found.</p>}
          <ul className="space-y-1.5">
            {results?.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{c.name}</div>
                  <div className="text-xs text-gray-500 truncate">
                    <span className="font-mono">{c.staffCode}</span> &bull; {c.store.client.shortName} — {c.store.name}
                    {c.onboardingFormStatus === 'SUBMITTED' && ' • already submitted'}
                  </div>
                </div>
                <Button size="sm" onClick={() => assign(c)} disabled={busy}>
                  <Link2 className="w-3.5 h-3.5 mr-1" /> Link
                </Button>
              </li>
            ))}
          </ul>

          <div className="pt-1 flex justify-end">
            <Button variant="ghost" size="sm" onClick={dismiss} disabled={busy} className="text-gray-500">
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Dismiss
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function FormSubmissionsPanel() {
  const [tab, setTab] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [rows, setRows] = useState<UnmatchedSubmissionRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listUnmatchedSubmissionsAction(tab));
    } catch (e: any) {
      toast.error(e.message || 'Failed to load submissions');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Inbox className="w-6 h-6 text-primary" /> Form Submissions to Review
          </h1>
          <p className="text-sm text-gray-500 max-w-2xl">
            Google Form responses that arrived but couldn&apos;t be matched to an employee — usually a mistyped or missing
            e-code. Link each one to the right person, or dismiss it.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-900 p-0.5 text-sm" role="tablist">
        {(['OPEN', 'RESOLVED'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md transition-colors ${
              tab === t ? 'bg-white dark:bg-gray-700 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'OPEN' ? 'Needs review' : 'Resolved'}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="py-12 text-center text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading...
        </div>
      ) : rows.length === 0 ? (
        <div className="py-14 text-center">
          <CheckCircle2 className="w-9 h-9 text-emerald-400 mx-auto mb-2" />
          <p className="font-medium text-gray-700 dark:text-gray-200">
            {tab === 'OPEN' ? 'Nothing to review' : 'No resolved submissions yet'}
          </p>
          {tab === 'OPEN' && (
            <p className="text-sm text-gray-500 mt-1">Every form response so far has matched an employee.</p>
          )}
        </div>
      ) : tab === 'OPEN' ? (
        <div className="space-y-3">
          {rows.map((r) => (
            <SubmissionCard key={r.id} row={r} onResolved={load} />
          ))}
        </div>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="p-0 divide-y">
            {rows.map((r) => (
              <div key={r.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <span className="font-mono">{r.staffCodeGuess ?? '(no code)'}</span>
                  <span className="text-gray-500"> &bull; submitted {fmt(r.submittedAt)}</span>
                </div>
                <Badge variant="secondary">
                  {r.resolution === 'ASSIGNED' ? 'Linked to employee' : 'Dismissed'}
                  {r.resolvedAt && ` • ${fmt(r.resolvedAt)}`}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
