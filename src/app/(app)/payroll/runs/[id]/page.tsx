import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { can } from '@/lib/auth/can';
import { prisma } from '@/lib/prisma';
import { monthLabel } from '@/lib/reports/period';
import { ymOf, type LineIdentity, type LineInputs } from '@/lib/payroll/service';
import type { PayrollResult } from '@/lib/payroll/engine';
import { deleteDraftRunAction, finalizeRunAction, generateRunAction, saveLineAction } from '../../actions';
import { Notice, btnCls, btnDangerCls, btnGhostCls, cardCls, one, rupees } from '../../_ui';

export const dynamic = 'force-dynamic';

const small = 'h-8 w-16 rounded border border-slate-300 bg-white px-1 text-right text-xs dark:border-slate-700 dark:bg-slate-900';

export default async function PayrollRunPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session, 'payroll:manage', {})) redirect('/dashboard');
  const { id } = await params;
  const sp = await searchParams;

  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: { client: { select: { name: true } }, lines: true },
  });
  if (!run) notFound();

  const draft = run.status === 'DRAFT';
  const ym = ymOf(run.periodYear, run.periodMonth);
  const lines = run.lines
    .map((l) => ({
      id: l.id, warnings: l.warnings,
      identity: l.identity as unknown as LineIdentity,
      inputs: l.inputs as unknown as LineInputs,
      result: l.result as unknown as PayrollResult | null,
    }))
    .sort((a, b) => a.identity.storeName.localeCompare(b.identity.storeName) || a.identity.staffCode.localeCompare(b.identity.staffCode));

  const sum = (f: (r: PayrollResult) => number) => lines.reduce((s, l) => s + (l.result ? f(l.result) : 0), 0);
  const noSlab = lines.filter((l) => !l.result).length;
  const warned = lines.filter((l) => l.warnings.length > 0 && l.result).length;
  const cards: [string, string][] = [
    ['Employees', String(lines.length)],
    ['Gross', `₹${rupees(sum((r) => r.gross))}`],
    ['Net payout', `₹${rupees(sum((r) => r.netTakeHome))}`],
    ['Employer cost (CTC)', `₹${rupees(sum((r) => r.fixedCtc))}`],
    ['Total PF', `₹${rupees(sum((r) => r.totalPf))}`],
    ['Total ESIC', `₹${rupees(sum((r) => r.totalEsic))}`],
  ];

  return (
    <div className="container mx-auto space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/payroll" className="text-sm text-primary hover:underline">← All runs</Link>
          <h1 className="text-2xl font-bold tracking-tight">{run.client.name} — {monthLabel(ym)}</h1>
          <p className="text-sm text-muted-foreground">
            {draft ? 'Draft — attendance can be re-pulled and inputs edited.' : `Finalized ${run.finalizedAt ? run.finalizedAt.toLocaleDateString('en-IN') : ''} — locked.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/payroll/runs/${run.id}/download`} className={btnCls}>Download payout sheet (Excel)</a>
          {draft && (
            <form action={generateRunAction}>
              <input type="hidden" name="clientId" value={run.clientId} /><input type="hidden" name="month" value={ym} /><input type="hidden" name="returnTo" value={`/payroll/runs/${run.id}`} />
              <button className={btnGhostCls} type="submit">Re-pull attendance &amp; slabs</button>
            </form>
          )}
        </div>
      </div>

      <Notice error={one(sp.error)} ok={one(sp.ok)} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {cards.map(([k, v]) => (
          <div key={k} className={cardCls}><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-semibold">{v}</div></div>
        ))}
      </div>
      {(noSlab > 0 || warned > 0) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {noSlab > 0 && <div><b>{noSlab}</b> employee(s) have no salary slab and are paid 0 — assign slabs in <Link className="underline" href={`/payroll/setup?clientId=${run.clientId}`}>Payroll setup</Link>, then re-pull.</div>}
          {warned > 0 && <div><b>{warned}</b> employee(s) have attendance warnings (hover the ⚠ on their row).</div>}
        </div>
      )}

      <div className={`${cardCls} overflow-x-auto p-0`}>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left uppercase text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="p-2">Employee</th><th className="p-2">Slab</th>
              <th className="p-2 text-right">Pres.</th><th className="p-2 text-right">WO</th><th className="p-2 text-right">Half</th><th className="p-2 text-right">Abs.</th><th className="p-2 text-right">Paid days</th>
              {draft && (<><th className="p-2">Bonus d.</th><th className="p-2">OT d.</th><th className="p-2">OT hrs</th><th className="p-2">PT</th><th className="p-2">LWF</th><th className="p-2" /></>)}
              <th className="p-2 text-right">Gross</th><th className="p-2 text-right">Incl. bonus</th><th className="p-2 text-right">PF+ESIC (emp.)</th><th className="p-2 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const a = l.inputs.attendance;
              const m = l.inputs.manual;
              const r = l.result;
              const form = `line-${l.id}`;
              return (
                <tr key={l.id} className={`border-t border-slate-100 dark:border-slate-800 ${r ? '' : 'bg-red-50 dark:bg-red-950'}`}>
                  <td className="p-2">
                    <div className="font-medium">{l.identity.name} {l.warnings.length > 0 && <span title={l.warnings.join('\n')} className="cursor-help">⚠</span>}</div>
                    <div className="text-slate-500">{l.identity.staffCode} · {l.identity.storeName} · {l.identity.designation.replace(/_/g, ' ')}</div>
                  </td>
                  <td className="p-2">{l.inputs.slab ? `${l.inputs.slab.name}${l.inputs.slab.source === 'DEFAULT' ? ' (default)' : ''}` : <span className="text-red-600">No slab</span>}</td>
                  <td className="p-2 text-right">{a.presentDays}</td><td className="p-2 text-right">{a.weekOffDays}</td><td className="p-2 text-right">{a.halfDays}</td><td className="p-2 text-right">{a.absentDays}</td>
                  <td className="p-2 text-right">{r?.salariedDays ?? '—'}</td>
                  {draft && (
                    <>
                      <td className="p-2"><input form={form} name="bonusDays" type="number" step="0.5" min="0" defaultValue={m.bonusDays} className={small} /></td>
                      <td className="p-2"><input form={form} name="otFullDays" type="number" step="0.5" min="0" defaultValue={m.otFullDays} className={small} /></td>
                      <td className="p-2"><input form={form} name="otHours" type="number" step="0.25" min="0" defaultValue={m.otHours ?? ''} placeholder={String(a.otHours)} className={small} /></td>
                      <td className="p-2"><input form={form} name="pt" type="number" min="0" defaultValue={m.pt ?? ''} placeholder="auto" className={small} /><input form={form} name="insurance" type="hidden" value={m.insurance ?? ''} /></td>
                      <td className="p-2"><input form={form} name="lwf" type="number" min="0" defaultValue={m.lwf ?? ''} placeholder="auto" className={small} /></td>
                      <td className="p-2">
                        <form id={form} action={saveLineAction}><input type="hidden" name="lineId" value={l.id} /><button className={btnGhostCls} type="submit">Save</button></form>
                      </td>
                    </>
                  )}
                  <td className="p-2 text-right">{rupees(r?.gross)}</td><td className="p-2 text-right">{rupees(r?.bonusPay)}</td>
                  <td className="p-2 text-right">{r ? rupees(r.pfEmployee + r.esicEmployee) : '—'}</td>
                  <td className="p-2 text-right font-semibold">{rupees(r?.netTakeHome)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className={`${cardCls} flex flex-wrap items-end justify-between gap-4`}>
          <form action={finalizeRunAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="runId" value={run.id} />
            {noSlab > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmNoSlab" /> Finalize anyway ({noSlab} without slab are paid 0)</label>}
            <button className={btnCls} type="submit">Finalize &amp; lock this month</button>
            <span className="text-xs text-slate-500">Only possible after the month&apos;s last day. A finalized run never changes, even if slabs or rates are edited later.</span>
          </form>
          <form action={deleteDraftRunAction}><input type="hidden" name="runId" value={run.id} /><button className={btnDangerCls} type="submit">Delete draft</button></form>
        </div>
      )}
    </div>
  );
}
