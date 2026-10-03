import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/can';
import { prisma } from '@/lib/prisma';
import { monthLabel } from '@/lib/reports/period';
import { ymOf } from '@/lib/payroll/service';
import { generateRunAction } from './actions';
import { Field, Notice, btnCls, btnGhostCls, cardCls, inputCls, one, rupees } from './_ui';

export const metadata = { title: 'Salary & Payroll | HRMS Platform' };
export const dynamic = 'force-dynamic';

export default async function PayrollHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session, 'payroll:manage', {})) redirect('/dashboard');
  const sp = await searchParams;

  const [clients, runs] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.payrollRun.findMany({
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
      take: 60,
      include: { client: { select: { name: true } }, lines: { select: { gross: true, netTakeHome: true, result: true } } },
    }),
  ]);
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const defaultMonth = ymOf(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1);

  return (
    <div className="container mx-auto space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Salary &amp; Payroll</h1>
          <p className="text-sm text-muted-foreground">Salary slabs, PF/ESIC calculation and monthly payout sheets. Administrators only.</p>
        </div>
        <Link href="/payroll/setup" className={btnGhostCls}>Slabs &amp; compliance settings</Link>
      </div>

      <Notice error={one(sp.error)} ok={one(sp.ok)} />

      <form action={generateRunAction} className={`${cardCls} grid gap-3 sm:grid-cols-4 sm:items-end`}>
        <Field label="Client">
          <select name="clientId" required className={inputCls} defaultValue="">
            <option value="" disabled>Select client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Month" hint="Draft is created, or refreshed if it already exists.">
          <input type="month" name="month" required defaultValue={defaultMonth} className={inputCls} />
        </Field>
        <button type="submit" className={btnCls}>Create / refresh draft</button>
      </form>

      <div className={`${cardCls} overflow-x-auto p-0`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="p-3">Month</th><th className="p-3">Client</th><th className="p-3">Status</th>
              <th className="p-3 text-right">Employees</th><th className="p-3 text-right">Gross</th><th className="p-3 text-right">Net payout</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">No payroll runs yet.</td></tr>}
            {runs.map((r) => {
              const missing = r.lines.filter((l) => l.result == null).length;
              return (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-3 font-medium">{monthLabel(ymOf(r.periodYear, r.periodMonth))}</td>
                  <td className="p-3">{r.client.name}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === 'FINALIZED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{r.status === 'FINALIZED' ? 'Finalized' : 'Draft'}</span>
                    {missing > 0 && <span className="ml-2 text-xs text-red-600">{missing} without slab</span>}
                  </td>
                  <td className="p-3 text-right">{r.lines.length}</td>
                  <td className="p-3 text-right">₹{rupees(r.lines.reduce((s, l) => s + l.gross, 0))}</td>
                  <td className="p-3 text-right">₹{rupees(r.lines.reduce((s, l) => s + l.netTakeHome, 0))}</td>
                  <td className="p-3 text-right"><Link href={`/payroll/runs/${r.id}`} className="text-primary hover:underline">Open</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
