import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Designation } from '@prisma/client';
import { auth } from '@/auth';
import { can } from '@/lib/auth/can';
import { prisma } from '@/lib/prisma';
import { configFromRow } from '@/lib/payroll/service';
import {
  archiveSlabAction, assignSlabAction, saveConfigAction, saveEmployeeIdsAction, saveSlabAction,
} from '../actions';
import { Field, Notice, btnCls, btnDangerCls, btnGhostCls, cardCls, inputCls, one, rupees } from '../_ui';

export const metadata = { title: 'Payroll setup | HRMS Platform' };
export const dynamic = 'force-dynamic';

const DESIGNATIONS = Object.values(Designation);
const label = (d: string) => d.replace(/_/g, ' ');
const EMP_LIMIT = 300;

export default async function PayrollSetup({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session, 'payroll:manage', {})) redirect('/dashboard');
  const sp = await searchParams;

  const clients = await prisma.client.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  const clientId = one(sp.clientId) ?? '';
  const client = clients.find((c) => c.id === clientId);
  const msg = <Notice error={one(sp.error)} ok={one(sp.ok)} />;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payroll setup</h1>
        <p className="text-sm text-muted-foreground">Compliance rates, salary slabs and who gets which slab — per client.</p>
      </div>
      <Link href="/payroll" className={btnGhostCls}>← Payroll runs</Link>
    </div>
  );

  const picker = (
    <form className={`${cardCls} flex flex-wrap items-end gap-3`}>
      <Field label="Client">
        <select name="clientId" defaultValue={clientId} className={inputCls}>
          <option value="">Select client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <button className={btnCls} type="submit">Open</button>
    </form>
  );

  if (!client) {
    return <div className="container mx-auto space-y-6 px-4 py-6">{header}{msg}{picker}</div>;
  }

  const desigFilter = one(sp.designation) && DESIGNATIONS.includes(one(sp.designation) as Designation) ? (one(sp.designation) as Designation) : undefined;
  const q = (one(sp.q) ?? '').trim();
  const editId = one(sp.edit);

  const [cfgRow, slabs, employees, empTotal] = await Promise.all([
    prisma.clientPayrollConfig.findUnique({ where: { clientId } }),
    prisma.salarySlab.findMany({ where: { clientId, isActive: true }, orderBy: [{ designation: 'asc' }, { name: 'asc' }], include: { _count: { select: { assignments: true } } } }),
    prisma.employee.findMany({
      where: {
        store: { clientId }, status: 'ACTIVE', ...(desigFilter ? { designation: desigFilter } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { staffCode: { contains: q } }] } : {}),
      },
      include: { store: { select: { name: true } }, salaryAssignment: true },
      orderBy: [{ store: { name: 'asc' } }, { name: 'asc' }],
      take: EMP_LIMIT,
    }),
    prisma.employee.count({ where: { store: { clientId }, status: 'ACTIVE', ...(desigFilter ? { designation: desigFilter } : {}), ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { staffCode: { contains: q } }] } : {}) } }),
  ]);
  const cfg = configFromRow(cfgRow);
  const editing = editId ? slabs.find((s) => s.id === editId) : undefined;
  const defaultBy = new Map(slabs.filter((s) => s.isDefault).map((s) => [s.designation, s]));
  const slabById = new Map(slabs.map((s) => [s.id, s]));
  const here = `/payroll/setup?clientId=${clientId}${desigFilter ? `&designation=${desigFilter}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <div className="container mx-auto space-y-6 px-4 py-6">
      {header}
      {msg}
      {picker}
      <h2 className="text-lg font-semibold">{client.name}</h2>

      {/* ── Compliance settings ── */}
      <form action={saveConfigAction} className={`${cardCls} space-y-4`}>
        <input type="hidden" name="clientId" value={clientId} />
        <div>
          <h3 className="font-semibold">Compliance settings</h3>
          <p className="text-xs text-slate-500">Percentages are plain numbers (12 = 12 %). PF and ESIC are worked out on prorated basic + special allowance only — never on overtime, bonus, HRA or travelling allowance. Check these with your compliance advisor — they decide every employee&apos;s PF and ESIC.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="PF – employee %"><input name="pfEmployeePct" type="number" step="0.01" defaultValue={cfg.pfEmployeePct} className={inputCls} /></Field>
          <Field label="PF – employer %"><input name="pfEmployerPct" type="number" step="0.01" defaultValue={cfg.pfEmployerPct} className={inputCls} /></Field>
          <Field label="PF admin charges %"><input name="pfAdminPct" type="number" step="0.01" defaultValue={cfg.pfAdminPct} className={inputCls} /></Field>
          <Field label="PF wage ceiling ₹" hint="Blank = PF on full basic"><input name="pfWageCeiling" type="number" defaultValue={cfg.pfWageCeiling ?? ''} className={inputCls} /></Field>
          <Field label="ESIC – employee %"><input name="esicEmployeePct" type="number" step="0.01" defaultValue={cfg.esicEmployeePct} className={inputCls} /></Field>
          <Field label="ESIC – employer %"><input name="esicEmployerPct" type="number" step="0.01" defaultValue={cfg.esicEmployerPct} className={inputCls} /></Field>
          <Field label="ESIC applies if basic + special ≤ ₹"><input name="esicGrossLimit" type="number" defaultValue={cfg.esicGrossLimit} className={inputCls} /></Field>
          <Field label="PF & ESIC calculated on"><div className="flex h-9 items-center text-sm font-medium">Basic + special allowance</div></Field>
          <Field label="Insurance ₹/month"><input name="insurance" type="number" defaultValue={cfg.insurance} className={inputCls} /></Field>
          <Field label="Professional tax ₹/month"><input name="pt" type="number" defaultValue={cfg.pt} className={inputCls} /></Field>
          <Field label="LWF ₹/month"><input name="lwf" type="number" defaultValue={cfg.lwf} className={inputCls} /></Field>
        </div>
        <button className={btnCls} type="submit">Save settings</button>
      </form>

      {/* ── Slabs ── */}
      <div className={`${cardCls} space-y-4`}>
        <div>
          <h3 className="font-semibold">Salary slabs</h3>
          <p className="text-xs text-slate-500">Monthly fixed amounts. Mark one slab per designation as the <b>client default</b> (use it for Associates: everyone gets it). Other designations are assigned person by person below.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Designation</th><th className="p-2">Slab</th><th className="p-2 text-right">Basic</th><th className="p-2 text-right">HRA</th><th className="p-2 text-right">Special</th><th className="p-2 text-right">Travel</th><th className="p-2">OT day / hr</th><th className="p-2">Bonus day</th><th className="p-2">Used by</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {slabs.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-slate-500">No slabs yet — add one below.</td></tr>}
              {slabs.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-2">{label(s.designation)}</td>
                  <td className="p-2 font-medium">{s.name}{s.isDefault && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">client default</span>}</td>
                  <td className="p-2 text-right">{rupees(s.basic)}</td><td className="p-2 text-right">{rupees(s.hra)}</td>
                  <td className="p-2 text-right">{rupees(s.specialAllowance)}</td><td className="p-2 text-right">{rupees(s.travellingAllowance)}</td>
                  <td className="p-2">{s.otDayRate ?? 'auto'} / {s.otHourRate ?? 'auto'}</td><td className="p-2">{s.bonusDayRate ?? 'auto'}</td>
                  <td className="p-2">{s.isDefault ? 'all unassigned' : `${s._count.assignments} assigned`}</td>
                  <td className="flex gap-2 p-2">
                    <Link href={`/payroll/setup?clientId=${clientId}&edit=${s.id}#slab-form`} className={btnGhostCls}>Edit</Link>
                    <form action={archiveSlabAction}><input type="hidden" name="id" value={s.id} /><button className={btnDangerCls} type="submit">Archive</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form id="slab-form" action={saveSlabAction} key={editing?.id ?? 'new'} className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="id" value={editing?.id ?? ''} />
          <h4 className="text-sm font-semibold">{editing ? `Edit slab: ${editing.name}` : 'Add a slab'}</h4>
          <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <Field label="Designation">
              <select name="designation" required defaultValue={editing?.designation ?? 'ASSOCIATE'} className={inputCls}>
                {DESIGNATIONS.map((d) => <option key={d} value={d}>{label(d)}</option>)}
              </select>
            </Field>
            <Field label="Slab name"><input name="name" required defaultValue={editing?.name ?? ''} placeholder="e.g. Manager – A" className={inputCls} /></Field>
            <Field label="Basic ₹"><input name="basic" type="number" required defaultValue={editing?.basic ?? ''} className={inputCls} /></Field>
            <Field label="HRA ₹"><input name="hra" type="number" required defaultValue={editing?.hra ?? 0} className={inputCls} /></Field>
            <Field label="Special allowance ₹"><input name="specialAllowance" type="number" defaultValue={editing?.specialAllowance ?? 0} className={inputCls} /></Field>
            <Field label="Travelling allowance ₹"><input name="travellingAllowance" type="number" defaultValue={editing?.travellingAllowance ?? 0} className={inputCls} /></Field>
            <Field label="OT ₹/day" hint="Blank = auto"><input name="otDayRate" type="number" defaultValue={editing?.otDayRate ?? ''} className={inputCls} /></Field>
            <Field label="OT ₹/hour" hint="Blank = auto"><input name="otHourRate" type="number" defaultValue={editing?.otHourRate ?? ''} className={inputCls} /></Field>
            <Field label="Bonus ₹/day" hint="Blank = auto"><input name="bonusDayRate" type="number" defaultValue={editing?.bonusDayRate ?? ''} className={inputCls} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" defaultChecked={editing?.isDefault ?? false} /> Client default for this designation (everyone of this designation without a personal slab)</label>
          <div className="flex gap-2">
            <button className={btnCls} type="submit">{editing ? 'Save changes' : 'Add slab'}</button>
            {editing && <Link href={`/payroll/setup?clientId=${clientId}`} className={btnGhostCls}>Cancel</Link>}
          </div>
        </form>
      </div>

      {/* ── Employees ── */}
      <div className={`${cardCls} space-y-4`}>
        <div>
          <h3 className="font-semibold">Employee pay assignments &amp; payroll IDs</h3>
          <p className="text-xs text-slate-500">Assign a personal slab to Store Managers, Shift Incharges, Process/Quality Associates and Housekeeping. Anyone without one gets their designation&apos;s client default. Showing {employees.length} of {empTotal} active employees.</p>
        </div>
        <form className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <Field label="Designation">
            <select name="designation" defaultValue={desigFilter ?? ''} className={inputCls}>
              <option value="">All</option>
              {DESIGNATIONS.map((d) => <option key={d} value={d}>{label(d)}</option>)}
            </select>
          </Field>
          <Field label="Name or e-code"><input name="q" defaultValue={q} className={inputCls} /></Field>
          <button className={btnGhostCls} type="submit">Filter</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Employee</th><th className="p-2">Designation</th><th className="p-2">Pay slab</th><th className="p-2">Father name / UAN / ESIC no. / bank a/c / IFSC</th></tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const assigned = e.salaryAssignment ? slabById.get(e.salaryAssignment.slabId) : undefined;
                const fallback = defaultBy.get(e.designation);
                const options = slabs.filter((s) => s.designation === e.designation);
                return (
                  <tr key={e.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="p-2"><div className="font-medium">{e.name}</div><div className="text-xs text-slate-500">{e.staffCode} · {e.store.name}</div></td>
                    <td className="p-2">{label(e.designation)}</td>
                    <td className="p-2">
                      <form action={assignSlabAction} className="flex items-center gap-2">
                        <input type="hidden" name="employeeId" value={e.id} /><input type="hidden" name="returnTo" value={here} />
                        <select name="slabId" defaultValue={assigned?.id ?? ''} className={`${inputCls} min-w-40`}>
                          <option value="">{fallback ? `Client default (${fallback.name})` : 'No slab'}</option>
                          {options.map((s) => <option key={s.id} value={s.id}>{s.name} — ₹{rupees(s.basic + s.hra + s.specialAllowance + s.travellingAllowance)}</option>)}
                        </select>
                        <button className={btnGhostCls} type="submit">Set</button>
                      </form>
                      {!assigned && !fallback && <div className="mt-1 text-xs text-red-600">Not paid until a slab exists</div>}
                    </td>
                    <td className="p-2">
                      <form action={saveEmployeeIdsAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="employeeId" value={e.id} /><input type="hidden" name="returnTo" value={here} />
                        <input name="fatherName" defaultValue={e.fatherName ?? ''} placeholder="Father name" className={`${inputCls} w-36`} />
                        <input name="uan" defaultValue={e.uan ?? ''} placeholder="UAN (12)" inputMode="numeric" className={`${inputCls} w-32`} />
                        <input name="esicNumber" defaultValue={e.esicNumber ?? ''} placeholder="ESIC no." inputMode="numeric" className={`${inputCls} w-32`} />
                        <input name="bankAccountNumber" defaultValue={e.bankAccountNumber ?? ''} placeholder="Bank a/c no." inputMode="numeric" autoComplete="off" className={`${inputCls} w-40`} />
                        <input name="ifscCode" defaultValue={e.ifscCode ?? ''} placeholder="IFSC" maxLength={11} autoComplete="off" className={`${inputCls} w-28 uppercase`} />
                        <button className={btnGhostCls} type="submit">Save</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
