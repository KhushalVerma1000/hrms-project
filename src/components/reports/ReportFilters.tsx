'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Filter, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface FilterValues {
  period: 'month' | 'quarter' | 'year' | 'custom';
  basis: 'fy' | 'calendar';
  year: number;
  month: number;
  quarter: number;
  from: string;
  to: string;
  clientId: string;
  storeId: string;
  mode: string;
  designation: string;
  status: string;
  q: string;
}

interface Props {
  values: FilterValues;
  clients: { id: string; name: string }[];
  stores: { id: string; name: string; clientId: string; clientName: string }[];
  designations: { value: string; label: string }[];
  statuses: { value: string; label: string }[];
  yearOptions: number[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const selectCls =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * A plain GET form: the URL *is* the filter state, so a filtered view can be bookmarked or
 * shared, and the download buttons reuse exactly the same query string.
 */
export function ReportFilters({ values, clients, stores, designations, statuses, yearOptions }: Props) {
  const [period, setPeriod] = useState(values.period);
  const [basis, setBasis] = useState(values.basis);
  const [clientId, setClientId] = useState(values.clientId);
  const [storeId, setStoreId] = useState(values.storeId);

  const fy = basis === 'fy' && (period === 'quarter' || period === 'year');
  const visibleStores = useMemo(() => stores.filter((s) => !clientId || s.clientId === clientId), [stores, clientId]);
  const storeStillValid = !storeId || visibleStores.some((s) => s.id === storeId);

  return (
    <form method="get" action="/reports" className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Filter className="h-4 w-4" aria-hidden /> Filters
        <span className="text-xs font-normal text-muted-foreground">— apply to the view and to every download</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Report period" htmlFor="period">
          <select id="period" name="period" className={selectCls} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly</option>
            <option value="year">Yearly</option>
            <option value="custom">Custom range</option>
          </select>
        </Field>

        {(period === 'quarter' || period === 'year') && (
          <Field label="Year type" htmlFor="basis">
            <select id="basis" name="basis" className={selectCls} value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
              <option value="fy">Financial year (Apr–Mar)</option>
              <option value="calendar">Calendar year (Jan–Dec)</option>
            </select>
          </Field>
        )}
        {period !== 'quarter' && period !== 'year' && <input type="hidden" name="basis" value={basis} />}

        {period !== 'custom' && (
          <Field label={fy ? 'Financial year' : 'Year'} htmlFor="year">
            <select id="year" name="year" className={selectCls} defaultValue={values.year}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{fy ? `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` : y}</option>
              ))}
            </select>
          </Field>
        )}

        {period === 'month' && (
          <Field label="Month" htmlFor="month">
            <select id="month" name="month" className={selectCls} defaultValue={values.month}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
        )}

        {period === 'quarter' && (
          <Field label="Quarter" htmlFor="quarter">
            <select id="quarter" name="quarter" className={selectCls} defaultValue={values.quarter}>
              {(basis === 'fy'
                ? ['Q1 (Apr–Jun)', 'Q2 (Jul–Sep)', 'Q3 (Oct–Dec)', 'Q4 (Jan–Mar)']
                : ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)']
              ).map((q, i) => <option key={q} value={i + 1}>{q}</option>)}
            </select>
          </Field>
        )}

        {period === 'custom' && (
          <>
            <Field label="From" htmlFor="from">
              <Input id="from" name="from" type="date" required defaultValue={values.from} />
            </Field>
            <Field label="To (max 366 days)" htmlFor="to">
              <Input id="to" name="to" type="date" required defaultValue={values.to} />
            </Field>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {clients.length > 1 && (
          <Field label="Client" htmlFor="clientId">
            <select id="clientId" name="clientId" className={selectCls} value={clientId} onChange={(e) => { setClientId(e.target.value); setStoreId(''); }}>
              <option value="">All clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        {stores.length > 1 && (
          <Field label="Store" htmlFor="storeId">
            <select id="storeId" name="storeId" className={selectCls} value={storeStillValid ? storeId : ''} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">All stores</option>
              {visibleStores.map((s) => (
                <option key={s.id} value={s.id}>{clients.length > 1 ? `${s.clientName} – ${s.name}` : s.name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Attendance mode" htmlFor="mode">
          <select id="mode" name="mode" className={selectCls} defaultValue={values.mode}>
            <option value="">Biometric + Manual</option>
            <option value="BIOMETRIC">Biometric stores</option>
            <option value="MANUAL">Manual stores</option>
          </select>
        </Field>
        <Field label="Designation" htmlFor="designation">
          <select id="designation" name="designation" className={selectCls} defaultValue={values.designation}>
            <option value="">All designations</option>
            {designations.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </Field>
        <Field label="Daily records: status" htmlFor="status">
          <select id="status" name="status" className={selectCls} defaultValue={values.status}>
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Search name or staff code" htmlFor="q">
          <Input id="q" name="q" placeholder="e.g. Ravi or 1010100109" defaultValue={values.q} autoComplete="off" />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-10">Apply filters</Button>
        <Button asChild variant="outline" className="h-10">
          <Link href="/reports"><RotateCcw className="mr-2 h-4 w-4" aria-hidden /> Reset</Link>
        </Button>
      </div>
    </form>
  );
}
