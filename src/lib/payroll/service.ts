import type { Session } from 'next-auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { STANDARD_SHIFT_HOURS } from '@/lib/config';
import { loadReport, todayKey } from '@/lib/reports/data';
import {
  calculatePayroll, DEFAULT_PAYROLL_CONFIG,
  type PayrollConfig, type PayrollResult, type SlabAmounts,
} from './engine';
import { emptyAttendance, summariseAttendance, type AttendanceSummary } from './attendance';

export const daysInMonthOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const ymOf = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

type ConfigRow = Prisma.ClientPayrollConfigGetPayload<object>;

export function configFromRow(row: ConfigRow | null): PayrollConfig {
  if (!row) return { ...DEFAULT_PAYROLL_CONFIG };
  return {
    pfEmployeePct: row.pfEmployeePct, pfEmployerPct: row.pfEmployerPct, pfAdminPct: row.pfAdminPct,
    pfWageCeiling: row.pfWageCeiling,
    esicEmployeePct: row.esicEmployeePct, esicEmployerPct: row.esicEmployerPct,
    esicGrossLimit: row.esicGrossLimit,
    insurance: row.insurance, pt: row.pt, lwf: row.lwf,
  };
}

export async function getClientConfig(clientId: string): Promise<PayrollConfig> {
  return configFromRow(await prisma.clientPayrollConfig.findUnique({ where: { clientId } }));
}

/** Values an admin can edit on a draft line. null = use the attendance / client default. */
export interface ManualInputs {
  bonusDays: number;
  otFullDays: number;
  otHours: number | null;
  pt: number | null;
  lwf: number | null;
  insurance: number | null;
}
export const NO_MANUAL: ManualInputs = { bonusDays: 0, otFullDays: 0, otHours: null, pt: null, lwf: null, insurance: null };

export interface LineInputs {
  daysInMonth: number;
  slab: (SlabAmounts & { id: string; name: string; source: 'ASSIGNED' | 'DEFAULT' }) | null;
  attendance: AttendanceSummary;
  manual: ManualInputs;
}

export interface LineIdentity {
  storeName: string;
  staffCode: string;
  name: string;
  fatherName: string | null;
  uan: string | null;
  esicNumber: string | null;
  designation: string;
  status: string;
}

/** The single place a line's numbers are produced — used on generate and on every edit. */
export function computeLine(inputs: LineInputs, config: PayrollConfig): { result: PayrollResult | null; gross: number; net: number } {
  if (!inputs.slab) return { result: null, gross: 0, net: 0 };
  const { attendance: a, manual: m } = inputs;
  const cfg: PayrollConfig = {
    ...config,
    pt: m.pt ?? config.pt, lwf: m.lwf ?? config.lwf, insurance: m.insurance ?? config.insurance,
  };
  const result = calculatePayroll(
    inputs.slab,
    cfg,
    {
      presentDays: a.presentDays, weekOffDays: a.weekOffDays, halfDays: a.halfDays, absentDays: a.absentDays,
      otFullDays: m.otFullDays, otHours: m.otHours ?? a.otHours, bonusDays: m.bonusDays,
    },
    { daysInMonth: inputs.daysInMonth, shiftHours: STANDARD_SHIFT_HOURS },
  );
  return { result, gross: result.gross, net: result.netTakeHome };
}

export function lineWarnings(inputs: LineInputs): string[] {
  const w: string[] = [];
  const a = inputs.attendance;
  if (!inputs.slab) w.push('No salary slab — not paid until one is assigned.');
  if (a.noPunchDays > 0) w.push(`${a.noPunchDays} day(s) with no punch counted as unpaid — review.`);
  if (a.notRecordedDays > 0) w.push(`${a.notRecordedDays} day(s) with no attendance entered counted as unpaid — review.`);
  if (a.recordedDays < inputs.daysInMonth) w.push(`Attendance exists for ${a.recordedDays} of ${inputs.daysInMonth} days.`);
  if (a.autoClosedShifts > 0) w.push(`${a.autoClosedShifts} shift(s) had no check-out and were counted as a full shift.`);
  const paid = a.presentDays + a.weekOffDays + a.halfDays * 0.5;
  if (paid > inputs.daysInMonth) w.push('Paid days exceed the days in the month — capped.');
  return w;
}

export class PayrollError extends Error {}

/**
 * Creates or refreshes the DRAFT run for a client + month: re-pulls attendance and slabs, keeps
 * every manual input an admin already entered, and never touches a FINALIZED run.
 */
export async function generateRun(session: Session, clientId: string, year: number, month: number) {
  const existing = await prisma.payrollRun.findUnique({
    where: { clientId_periodYear_periodMonth: { clientId, periodYear: year, periodMonth: month } },
    include: { lines: { select: { employeeId: true, inputs: true } } },
  });
  if (existing?.status === 'FINALIZED') throw new PayrollError('This month is finalized and locked.');

  const config = await getClientConfig(clientId);
  const today = todayKey();
  const ym = ymOf(year, month);
  const dim = daysInMonthOf(year, month);

  const data = await loadReport(
    session,
    { period: { type: 'month', year, month, quarter: 1, basis: 'fy' }, clientId },
    today,
  );
  const attendance = summariseAttendance(data.records, data.monthlyOt, ym);

  const [employees, defaultSlabs] = await Promise.all([
    prisma.employee.findMany({
      where: { store: { clientId }, OR: [{ status: 'ACTIVE' }, { id: { in: [...attendance.keys()] } }] },
      include: { store: { select: { name: true } }, salaryAssignment: { include: { slab: true } } },
      orderBy: [{ store: { name: 'asc' } }, { staffCode: 'asc' }],
    }),
    prisma.salarySlab.findMany({ where: { clientId, isDefault: true, isActive: true } }),
  ]);
  const defaultByDesignation = new Map(defaultSlabs.map((s) => [s.designation, s]));
  const previous = new Map(existing?.lines.map((l) => [l.employeeId, (l.inputs as unknown as LineInputs).manual]) ?? []);

  const slabOf = (s: { id: string; name: string } & SlabAmounts, source: 'ASSIGNED' | 'DEFAULT') => ({
    id: s.id, name: s.name, source,
    basic: s.basic, hra: s.hra, specialAllowance: s.specialAllowance, travellingAllowance: s.travellingAllowance,
    otDayRate: s.otDayRate, otHourRate: s.otHourRate, bonusDayRate: s.bonusDayRate,
  });

  const run = existing
    ? await prisma.payrollRun.update({ where: { id: existing.id }, data: { configSnapshot: config as unknown as Prisma.InputJsonObject } })
    : await prisma.payrollRun.create({
        data: {
          clientId, periodYear: year, periodMonth: month,
          configSnapshot: config as unknown as Prisma.InputJsonObject, createdByUserId: session.user.id,
        },
      });

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const e of employees) {
    const assigned = e.salaryAssignment?.slab;
    const fallback = defaultByDesignation.get(e.designation);
    const slab = assigned && assigned.isActive ? slabOf(assigned, 'ASSIGNED') : fallback ? slabOf(fallback, 'DEFAULT') : null;
    const inputs: LineInputs = {
      daysInMonth: dim, slab,
      attendance: attendance.get(e.id) ?? emptyAttendance(),
      manual: previous.get(e.id) ?? { ...NO_MANUAL },
    };
    const { result, gross, net } = computeLine(inputs, config);
    const identity: LineIdentity = {
      storeName: e.store.name, staffCode: e.staffCode, name: e.name, fatherName: e.fatherName,
      uan: e.uan, esicNumber: e.esicNumber, designation: e.designation, status: e.status,
    };
    const row = {
      identity: identity as unknown as Prisma.InputJsonObject,
      inputs: inputs as unknown as Prisma.InputJsonObject,
      result: (result ?? undefined) as unknown as Prisma.InputJsonObject | undefined,
      warnings: lineWarnings(inputs), gross, netTakeHome: net,
    };
    ops.push(prisma.payrollLine.upsert({
      where: { runId_employeeId: { runId: run.id, employeeId: e.id } },
      create: { runId: run.id, employeeId: e.id, ...row },
      update: { ...row, result: result ? (result as unknown as Prisma.InputJsonObject) : Prisma.JsonNull },
    }));
  }
  ops.push(prisma.payrollLine.deleteMany({ where: { runId: run.id, employeeId: { notIn: employees.map((e) => e.id) } } }));
  await prisma.$transaction(ops);

  return { runId: run.id, lines: employees.length, monthOver: data.period.to < today };
}
