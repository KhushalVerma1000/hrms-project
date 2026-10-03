'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Designation, Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { todayKey } from '@/lib/reports/data';
import { PayrollError, computeLine, generateRun, lineWarnings, ymOf, daysInMonthOf, type LineInputs, type ManualInputs } from '@/lib/payroll/service';
import type { PayrollConfig } from '@/lib/payroll/engine';

/** Every payroll action starts here. Never rely on hidden buttons. */
async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !can(session, 'payroll:manage', {})) throw new Error('Payroll is restricted to administrators.');
  return session;
}

function back(path: string, kind: 'error' | 'ok', msg: string): never {
  const sep = path.includes('?') ? '&' : '?';
  redirect(`${path}${sep}${kind}=${encodeURIComponent(msg)}`);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
function int(f: FormData, k: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number | null {
  const raw = str(f, k);
  if (raw === '') {
    if (opts.optional) return null;
    throw new PayrollError(`${k} is required.`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < (opts.min ?? 0) || n > (opts.max ?? 10_000_000)) throw new PayrollError(`${k} must be a whole number${opts.min != null ? ` ≥ ${opts.min}` : ''}.`);
  return n;
}
function num(f: FormData, k: string, min: number, max: number, optional = false): number | null {
  const raw = str(f, k);
  if (raw === '' && optional) return null;
  const n = Number(raw);
  if (raw === '' || !Number.isFinite(n) || n < min || n > max) throw new PayrollError(`${k} must be between ${min} and ${max}.`);
  return n;
}

async function guard<T>(path: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PayrollError) back(path, 'error', e.message);
    throw e; // includes Next's redirect signal
  }
}

// ── Compliance settings (per client) ─────────────────────────────────────────

export async function saveConfigAction(formData: FormData) {
  const session = await requireAdmin();
  const clientId = str(formData, 'clientId');
  const path = `/payroll/setup?clientId=${clientId}`;
  await guard(path, async () => {
    const data = {
      pfEmployeePct: num(formData, 'pfEmployeePct', 0, 100)!,
      pfEmployerPct: num(formData, 'pfEmployerPct', 0, 100)!,
      pfAdminPct: num(formData, 'pfAdminPct', 0, 100)!,
      pfWageCeiling: int(formData, 'pfWageCeiling', { optional: true }),
      esicEmployeePct: num(formData, 'esicEmployeePct', 0, 100)!,
      esicEmployerPct: num(formData, 'esicEmployerPct', 0, 100)!,
      esicGrossLimit: int(formData, 'esicGrossLimit')!,
      insurance: int(formData, 'insurance')!,
      pt: int(formData, 'pt')!,
      lwf: int(formData, 'lwf')!,
    };
    if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) throw new PayrollError('Unknown client.');
    await prisma.clientPayrollConfig.upsert({ where: { clientId }, create: { clientId, ...data }, update: data });
    await writeAuditLog({ userId: session.user.id, action: 'PAYROLL_CONFIG_UPDATE', targetType: 'Client', targetId: clientId, metadata: data });
  });
  revalidatePath('/payroll/setup');
  back(path, 'ok', 'Payroll settings saved. Existing drafts pick them up on their next refresh; finalized runs are unchanged.');
}

// ── Salary slabs ─────────────────────────────────────────────────────────────

export async function saveSlabAction(formData: FormData) {
  const session = await requireAdmin();
  const clientId = str(formData, 'clientId');
  const path = `/payroll/setup?clientId=${clientId}`;
  await guard(path, async () => {
    const designation = str(formData, 'designation') as Designation;
    if (!Object.values(Designation).includes(designation)) throw new PayrollError('Pick a designation.');
    const name = str(formData, 'name');
    if (!name) throw new PayrollError('Give the slab a name.');
    const data = {
      designation, name,
      basic: int(formData, 'basic')!,
      hra: int(formData, 'hra')!,
      specialAllowance: int(formData, 'specialAllowance', { optional: true }) ?? 0,
      travellingAllowance: int(formData, 'travellingAllowance', { optional: true }) ?? 0,
      otDayRate: int(formData, 'otDayRate', { optional: true }),
      otHourRate: int(formData, 'otHourRate', { optional: true }),
      bonusDayRate: int(formData, 'bonusDayRate', { optional: true }),
      isDefault: formData.get('isDefault') === 'on',
    };
    if (data.basic <= 0) throw new PayrollError('Basic must be more than 0.');
    const id = str(formData, 'id');

    const saved = await prisma.$transaction(async (tx) => {
      if (id) {
        const cur = await tx.salarySlab.findUnique({ where: { id } });
        if (!cur || cur.clientId !== clientId) throw new PayrollError('Slab not found.');
        if (cur.designation !== designation) {
          const inUse = await tx.employeeSalaryAssignment.count({ where: { slabId: id } });
          if (inUse > 0) throw new PayrollError('This slab is assigned to employees — create a new slab instead of changing its designation.');
        }
      }
      if (data.isDefault) {
        await tx.salarySlab.updateMany({ where: { clientId, designation, isDefault: true, NOT: id ? { id } : undefined }, data: { isDefault: false } });
      }
      try {
        return id
          ? await tx.salarySlab.update({ where: { id }, data: { ...data, isActive: true } })
          : await tx.salarySlab.create({ data: { clientId, ...data } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new PayrollError('A slab with that name already exists for this designation.');
        throw e;
      }
    });
    await writeAuditLog({ userId: session.user.id, action: 'SALARY_SLAB_SAVE', targetType: 'SalarySlab', targetId: saved.id, metadata: { clientId, ...data } });
  });
  revalidatePath('/payroll/setup');
  back(path, 'ok', 'Slab saved. It applies to drafts on their next refresh; finalized runs are unchanged.');
}

export async function archiveSlabAction(formData: FormData) {
  const session = await requireAdmin();
  const id = str(formData, 'id');
  const slab = await prisma.salarySlab.findUnique({ where: { id } });
  if (!slab) throw new Error('Slab not found.');
  const path = `/payroll/setup?clientId=${slab.clientId}`;
  await prisma.salarySlab.update({ where: { id }, data: { isActive: false, isDefault: false } });
  await writeAuditLog({ userId: session.user.id, action: 'SALARY_SLAB_ARCHIVE', targetType: 'SalarySlab', targetId: id, metadata: { name: slab.name } });
  revalidatePath('/payroll/setup');
  back(path, 'ok', 'Slab archived. Employees assigned to it will show "No slab" until reassigned.');
}

// ── Employee ↔ slab, and payroll identity ────────────────────────────────────

export async function assignSlabAction(formData: FormData) {
  const session = await requireAdmin();
  const employeeId = str(formData, 'employeeId');
  const slabId = str(formData, 'slabId');
  const returnTo = str(formData, 'returnTo');
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, include: { store: { select: { clientId: true } } } });
  if (!emp) throw new Error('Employee not found.');
  const path = returnTo.startsWith('/payroll/setup') ? returnTo : `/payroll/setup?clientId=${emp.store.clientId}`;
  await guard(path, async () => {
    if (!slabId) {
      await prisma.employeeSalaryAssignment.deleteMany({ where: { employeeId } });
    } else {
      const slab = await prisma.salarySlab.findUnique({ where: { id: slabId } });
      if (!slab || !slab.isActive || slab.clientId !== emp.store.clientId) throw new PayrollError('That slab belongs to a different client or is archived.');
      if (slab.designation !== emp.designation) throw new PayrollError(`That slab is for ${slab.designation.replace(/_/g, ' ')}, but ${emp.name} is ${emp.designation.replace(/_/g, ' ')}.`);
      await prisma.employeeSalaryAssignment.upsert({
        where: { employeeId }, create: { employeeId, slabId, assignedByUserId: session.user.id }, update: { slabId, assignedByUserId: session.user.id },
      });
    }
    await writeAuditLog({ userId: session.user.id, action: 'SALARY_ASSIGN', targetType: 'Employee', targetId: employeeId, metadata: { slabId: slabId || null } });
  });
  revalidatePath('/payroll/setup');
  back(path, 'ok', `${emp.name}: ${slabId ? 'slab assigned' : 'personal slab removed (client default applies)'}.`);
}

export async function saveEmployeeIdsAction(formData: FormData) {
  const session = await requireAdmin();
  const employeeId = str(formData, 'employeeId');
  const returnTo = str(formData, 'returnTo');
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, include: { store: { select: { clientId: true } } } });
  if (!emp) throw new Error('Employee not found.');
  const path = returnTo.startsWith('/payroll/setup') ? returnTo : `/payroll/setup?clientId=${emp.store.clientId}`;
  await guard(path, async () => {
    const digits = (k: string) => str(formData, k).replace(/\s+/g, '');
    const uan = digits('uan');
    const esic = digits('esicNumber');
    if (uan && !/^\d{12}$/.test(uan)) throw new PayrollError('UAN must be 12 digits.');
    if (esic && !/^(\d{10}|\d{17})$/.test(esic)) throw new PayrollError('ESIC number must be 10 or 17 digits.');
    const account = digits('bankAccountNumber');
    const ifsc = digits('ifscCode').toUpperCase();
    if (account && !/^\d{9,18}$/.test(account)) throw new PayrollError('Bank account number must be 9–18 digits.');
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new PayrollError('IFSC must be 11 characters, e.g. SBIN0001234.');
    if (!!account !== !!ifsc) throw new PayrollError('Enter both the bank account number and the IFSC, or leave both blank.');
    await prisma.employee.update({
      where: { id: employeeId },
      data: {
        fatherName: str(formData, 'fatherName') || null, uan: uan || null, esicNumber: esic || null,
        bankAccountNumber: account || null, ifscCode: ifsc || null,
      },
    });
    await writeAuditLog({ userId: session.user.id, action: 'PAYROLL_IDS_UPDATE', targetType: 'Employee', targetId: employeeId, metadata: {} });
  });
  revalidatePath('/payroll/setup');
  back(path, 'ok', `${emp.name}: payroll details saved.`);
}

// ── Payroll runs ─────────────────────────────────────────────────────────────

export async function generateRunAction(formData: FormData) {
  const session = await requireAdmin();
  const clientId = str(formData, 'clientId');
  const ym = str(formData, 'month'); // YYYY-MM
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  const returnTo = str(formData, 'returnTo') || '/payroll';
  if (!m || !clientId) back(returnTo, 'error', 'Pick a client and a month.');
  const year = Number(m![1]);
  const month = Number(m![2]);
  if (month < 1 || month > 12 || year < 2020) back(returnTo, 'error', 'Invalid month.');

  const out = await guard(returnTo, () => generateRun(session, clientId, year, month));
  await writeAuditLog({ userId: session.user.id, action: 'PAYROLL_RUN_GENERATE', targetType: 'PayrollRun', targetId: out.runId, metadata: { clientId, ym, lines: out.lines } });
  revalidatePath('/payroll');
  const note = out.monthOver ? '' : ' This month is not over yet — days after today are not counted; refresh again after month-end.';
  back(`/payroll/runs/${out.runId}`, 'ok', `Attendance pulled for ${out.lines} employees.${note}`);
}

export async function saveLineAction(formData: FormData) {
  const session = await requireAdmin();
  const lineId = str(formData, 'lineId');
  const line = await prisma.payrollLine.findUnique({ where: { id: lineId }, include: { run: true } });
  if (!line) throw new Error('Line not found.');
  const path = `/payroll/runs/${line.runId}`;
  if (line.run.status !== 'DRAFT') back(path, 'error', 'This run is finalized and locked.');
  await guard(path, async () => {
    const days = daysInMonthOf(line.run.periodYear, line.run.periodMonth);
    const manual: ManualInputs = {
      bonusDays: num(formData, 'bonusDays', 0, days)!,
      otFullDays: num(formData, 'otFullDays', 0, days)!,
      otHours: num(formData, 'otHours', 0, 744, true),
      pt: int(formData, 'pt', { optional: true }),
      lwf: int(formData, 'lwf', { optional: true }),
      insurance: int(formData, 'insurance', { optional: true }),
    };
    const inputs = { ...(line.inputs as unknown as LineInputs), manual };
    const config = line.run.configSnapshot as unknown as PayrollConfig;
    const { result, gross, net } = computeLine(inputs, config);
    await prisma.payrollLine.update({
      where: { id: lineId },
      data: {
        inputs: inputs as unknown as Prisma.InputJsonObject,
        result: result ? (result as unknown as Prisma.InputJsonObject) : Prisma.JsonNull,
        warnings: lineWarnings(inputs), gross, netTakeHome: net,
      },
    });
    await writeAuditLog({ userId: session.user.id, action: 'PAYROLL_LINE_EDIT', targetType: 'PayrollLine', targetId: lineId, metadata: { manual } });
  });
  revalidatePath(path);
  back(path, 'ok', 'Line updated.');
}

export async function finalizeRunAction(formData: FormData) {
  const session = await requireAdmin();
  const runId = str(formData, 'runId');
  const path = `/payroll/runs/${runId}`;
  await guard(path, async () => {
    const run = await prisma.payrollRun.findUnique({ where: { id: runId }, include: { lines: { select: { result: true, warnings: true } } } });
    if (!run) throw new PayrollError('Run not found.');
    if (run.status === 'FINALIZED') throw new PayrollError('Already finalized.');
    const last = `${ymOf(run.periodYear, run.periodMonth)}-${String(daysInMonthOf(run.periodYear, run.periodMonth)).padStart(2, '0')}`;
    if (last >= todayKey()) throw new PayrollError('The month is not over yet — finalize after its last day.');
    const noSlab = run.lines.filter((l) => l.result == null).length;
    if (noSlab > 0 && str(formData, 'confirmNoSlab') !== 'on') {
      throw new PayrollError(`${noSlab} employee(s) have no slab and would be paid 0. Tick "finalize anyway" to confirm, or assign slabs and refresh.`);
    }
    await prisma.payrollRun.update({ where: { id: runId }, data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedByUserId: session.user.id } });
    await writeAuditLog({ userId: session.user.id, action: 'PAYROLL_RUN_FINALIZE', targetType: 'PayrollRun', targetId: runId, metadata: { lines: run.lines.length, withoutSlab: noSlab } });
  });
  revalidatePath(path);
  back(path, 'ok', 'Run finalized and locked.');
}

export async function deleteDraftRunAction(formData: FormData) {
  const session = await requireAdmin();
  const runId = str(formData, 'runId');
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) back('/payroll', 'error', 'Run not found.');
  if (run!.status !== 'DRAFT') back(`/payroll/runs/${runId}`, 'error', 'Finalized runs cannot be deleted.');
  await prisma.payrollRun.delete({ where: { id: runId } });
  await writeAuditLog({ userId: session.user.id, action: 'PAYROLL_RUN_DELETE', targetType: 'PayrollRun', targetId: runId, metadata: { clientId: run!.clientId, year: run!.periodYear, month: run!.periodMonth } });
  revalidatePath('/payroll');
  back('/payroll', 'ok', 'Draft deleted.');
}
