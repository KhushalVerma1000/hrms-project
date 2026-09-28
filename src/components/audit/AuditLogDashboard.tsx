'use client';

import { Fragment, useCallback, useEffect, useState, useTransition } from 'react';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AUDIT_CATEGORIES } from '@/lib/audit/catalog';
import { getAuditLogAction, type AuditFilters, type AuditLogResult } from '@/app/(app)/audit-log/actions';

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const SEVERITY_STYLE: Record<string, string> = {
  info: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  notice: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 text-3xl font-bold ${tone === 'danger' && value > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export function AuditLogDashboard({ isAdmin }: { isAdmin: boolean }) {
  const [filters, setFilters] = useState<AuditFilters>({ page: 1 });
  const [searchInput, setSearchInput] = useState('');
  const [data, setData] = useState<AuditLogResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback((f: AuditFilters) => {
    startTransition(async () => {
      try {
        setError(null);
        setData(await getAuditLogAction(f));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the audit log.');
      }
    });
  }, []);

  useEffect(() => { load(filters); }, [filters, load]);

  // Debounce the free-text search so we don't query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === (searchInput || undefined) ? f : { ...f, search: searchInput || undefined, page: 1 }));
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const set = (patch: Partial<AuditFilters>) => setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasFilters = !!(filters.category || filters.action || filters.severity || filters.search || filters.from || filters.to);
  const visibleActions = data?.actionOptions.filter((a) => !filters.category || a.category === filters.category) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="text-muted-foreground mt-1">
          {isAdmin ? 'Every change made across the platform.' : 'Every change made to your stores, employees, devices and users.'}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Events today" value={data?.stats.today ?? 0} />
        <Stat label="Events, last 7 days" value={data?.stats.last7Days ?? 0} />
        <Stat label="Active users, last 7 days" value={data?.stats.activeUsers7Days ?? 0} />
        <Stat label="Deletions & clears, last 7 days" value={data?.stats.critical7Days ?? 0} tone="danger" />
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Search person or record ID</label>
            <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="e.g. Priya, or an ID" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block">Area</label>
            <select className={SELECT_CLASS} value={filters.category ?? ''} onChange={(e) => set({ category: e.target.value || undefined, action: undefined })}>
              <option value="">All areas</option>
              {AUDIT_CATEGORIES.filter((c) => data?.actionOptions.some((a) => a.category === c) ?? true).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block">Event</label>
            <select className={SELECT_CLASS} value={filters.action ?? ''} onChange={(e) => set({ action: e.target.value || undefined })}>
              <option value="">All events</option>
              {visibleActions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block">Importance</label>
            <select className={SELECT_CLASS} value={filters.severity ?? ''} onChange={(e) => set({ severity: (e.target.value || undefined) as AuditFilters['severity'] })}>
              <option value="">All</option>
              <option value="critical">Deletions & clears</option>
              <option value="notice">Notable changes</option>
              <option value="info">Routine</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block">From</label>
            <Input type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block">To</label>
            <Input type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setSearchInput(''); setFilters({ page: 1 }); }}>
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              <TableRow><TableCell colSpan={5} className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></TableCell></TableRow>
            ) : data.rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                {hasFilters ? 'No events match these filters.' : 'No activity recorded yet.'}
              </TableCell></TableRow>
            ) : (
              data.rows.map((r) => (
                <Fragment key={r.id}>
                  <TableRow
                    className={isAdmin && r.details ? 'cursor-pointer hover:bg-muted/50' : undefined}
                    onClick={() => isAdmin && r.details && setExpanded(expanded === r.id ? null : r.id)}
                  >
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(r.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{r.actor}</div>
                      {isAdmin && <div className="text-xs text-muted-foreground">{r.actorRole.replace(/_/g, ' ').toLowerCase()}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={SEVERITY_STYLE[r.severity]}>{r.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{r.target}</div>
                      <div className="text-xs text-muted-foreground">{r.targetType}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[280px]">{r.summary || '—'}</TableCell>
                  </TableRow>
                  {isAdmin && expanded === r.id && (
                    <TableRow>
                      <TableCell colSpan={5} className="bg-muted/30">
                        <pre className="text-xs overflow-x-auto p-2">{JSON.stringify(r.details, null, 2)}</pre>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
            {pending && <Loader2 className="inline w-3 h-3 animate-spin ml-2" />}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={data.page <= 1 || pending} onClick={() => setFilters((f) => ({ ...f, page: data.page - 1 }))}>
              <ChevronLeft className="w-4 h-4" /> Previous
            </Button>
            <span>Page {data.page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={data.page >= totalPages || pending} onClick={() => setFilters((f) => ({ ...f, page: data.page + 1 }))}>
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
