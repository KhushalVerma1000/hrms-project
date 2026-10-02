import type { Prisma } from '@prisma/client';
import type { Session } from 'next-auth';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { prisma } from '@/lib/prisma';
import { SHIFT_WINDOW_HOURS, SMARTOFFICE_TIMEZONE } from '@/lib/config';
import { can } from '@/lib/auth/can';
import { addDays, resolvePeriod, type ResolvedPeriod } from './period';
import type { ReportFilters } from './filters';
import { groupIntoShifts } from './sessions';
import { applyHoursRules } from './rules';
import type { DayRecord, DayStatus, MonthlyOt } from './types';

/** Above this many employee-days, ask the user to narrow the filters instead of risking a timeout. */
export const MAX_REPORT_ROWS = 250_000;

export class ReportTooLargeError extends Error {
  constructor(public rows: number) {
    super(
      `This selection covers about ${rows.toLocaleString('en-IN')} employee-days, which is too many to build in one go. ` +
      'Pick a single store or a shorter period and try again.',
    );
  }
}

export interface ScopedStore {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  mode: 'BIOMETRIC' | 'MANUAL';
}

export interface ReportData {
  period: ResolvedPeriod;
  /** Last day with data to show: the period end, or today if the period is still running. */
  effectiveTo: string;
  /** Every store this user may report on (feeds the filter dropdowns). */
  scopeStores: ScopedStore[];
  /** Daily rows for the selected stores/people. Status filter NOT applied. */
  records: DayRecord[];
  monthlyOt: MonthlyOt;
}

export const todayKey = () => formatInTimeZone(new Date(), SMARTOFFICE_TIMEZONE, 'yyyy-MM-dd');

/**
 * Which stores may this person report on? The ONLY place report scope is decided.
 *   ADMIN → everything · CLIENT → their client's stores · MANAGER → their own store
 * Anyone else (or a client/manager account missing its client/store) gets nothing.
 */
export function storeScopeWhere(session: Session): Prisma.StoreWhereInput | null {
  if (!can(session, 'reports:view', {})) return null;
  const { role, clientId, storeId } = session.user;
  if (role === 'ADMIN') return {};
  if (role === 'CLIENT') return clientId ? { clientId } : null;
  if (role === 'MANAGER') return storeId ? { id: storeId } : null;
  return null;
}

export async function getScopeStores(session: Session): Promise<ScopedStore[]> {
  const where = storeScopeWhere(session);
  if (!where) return [];
  const stores = await prisma.store.findMany({
    where,
    select: { id: true, name: true, clientId: true, attendanceMode: true, client: { select: { shortName: true } } },
    orderBy: [{ client: { shortName: 'asc' } }, { name: 'asc' }],
  });
  return stores.map((s) => ({
    id: s.id, name: s.name, clientId: s.clientId, clientName: s.client.shortName, mode: s.attendanceMode,
  }));
}

// Manual check-in/out are written with setHours() on the server (see manual/actions.ts),
// so they are read back the same way.
const hhmmLocal = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const hhmmZone = (d: Date) => formatInTimeZone(d, SMARTOFFICE_TIMEZONE, 'HH:mm');
const dateKeyZone = (d: Date) => formatInTimeZone(d, SMARTOFFICE_TIMEZONE, 'yyyy-MM-dd');
const round2 = (n: number) => Math.round(n * 100) / 100;
const nextMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/** All shifts a person STARTED on one day (almost always exactly one). */
interface PunchDay { first: Date; last: Date; punches: number; hours: number | null; autoClosed: number }

/** Punches fetched per query, so a big selection never holds every raw punch in memory at once. */
const PUNCH_CHUNK = 300;

export async function loadReport(session: Session, filters: ReportFilters, today = todayKey()): Promise<ReportData> {
  const period = resolvePeriod(filters.period);
  const effectiveTo = period.to < today ? period.to : today;
  const scopeStores = await getScopeStores(session);

  const empty: ReportData = { period, effectiveTo, scopeStores, records: [], monthlyOt: new Map() };
  if (scopeStores.length === 0 || period.from > effectiveTo) return empty;

  // Filters can only narrow the scope, never widen it.
  const stores = scopeStores.filter(
    (s) =>
      (!filters.clientId || s.clientId === filters.clientId) &&
      (!filters.storeId || s.id === filters.storeId) &&
      (!filters.mode || s.mode === filters.mode),
  );
  if (stores.length === 0) return empty;
  const storeById = new Map(stores.map((s) => [s.id, s]));

  // Everyone in those stores — biometric "store open" days need the whole team, not just the filtered people.
  const allEmployees = await prisma.employee.findMany({
    where: { storeId: { in: stores.map((s) => s.id) } },
    select: {
      id: true, staffCode: true, name: true, designation: true, status: true, storeId: true,
      dateOfJoining: true, dateOfRelieving: true,
    },
  });

  // ── Biometric punches → shifts ──
  // Stores run overnight and rotating shifts, so punches are grouped into shifts (not calendar
  // days) and each shift counts on the day it started. The fetch reaches 1 day back (so the
  // tail of a shift that began before the period is not mistaken for a new one) and 2 days
  // forward (so a night shift starting on the last day is complete).
  const bioCodes = allEmployees.filter((e) => storeById.get(e.storeId)!.mode === 'BIOMETRIC').map((e) => e.staffCode);
  const punchesByCode = new Map<string, Map<string, PunchDay>>();
  if (bioCodes.length > 0) {
    const fromInstant = fromZonedTime(`${addDays(period.from, -1)}T00:00:00`, SMARTOFFICE_TIMEZONE);
    const toInstant = fromZonedTime(`${addDays(effectiveTo, 2)}T00:00:00`, SMARTOFFICE_TIMEZONE);
    for (let i = 0; i < bioCodes.length; i += PUNCH_CHUNK) {
      const rows = await prisma.attendanceLog.findMany({
        where: { employeeCode: { in: bioCodes.slice(i, i + PUNCH_CHUNK) }, logDate: { gte: fromInstant, lt: toInstant } },
        select: { employeeCode: true, logDate: true },
        orderBy: [{ employeeCode: 'asc' }, { logDate: 'asc' }],
      });
      const byCode = new Map<string, Date[]>();
      for (const r of rows) {
        const list = byCode.get(r.employeeCode);
        if (list) list.push(r.logDate); else byCode.set(r.employeeCode, [r.logDate]);
      }
      for (const [code, punches] of byCode) {
        const days = new Map<string, PunchDay>();
        for (const shift of groupIntoShifts(punches, SHIFT_WINDOW_HOURS)) {
          const day = dateKeyZone(shift.first);
          if (day < period.from || day > effectiveTo) continue; // belongs to a neighbouring period
          const measured = shift.punches >= 2 ? (shift.last.getTime() - shift.first.getTime()) / 3_600_000 : null;
          const { hours: worked, notes } = applyHoursRules({ checkedIn: true, checkedOut: shift.punches >= 2, measuredHours: measured });
          const prev = days.get(day);
          days.set(day, prev
            ? { // a second shift starting the same day: add it up
                first: prev.first < shift.first ? prev.first : shift.first,
                last: prev.last > shift.last ? prev.last : shift.last,
                punches: prev.punches + shift.punches,
                hours: prev.hours === null && worked === null ? null : (prev.hours ?? 0) + (worked ?? 0),
                autoClosed: prev.autoClosed + notes.length,
              }
            : { first: shift.first, last: shift.last, punches: shift.punches, hours: worked, autoClosed: notes.length });
        }
        punchesByCode.set(code, days);
      }
    }
  }

  // Days each biometric store was actually open (somebody punched).
  const openDays = new Map<string, Set<string>>();
  for (const e of allEmployees) {
    const days = punchesByCode.get(e.staffCode);
    if (!days) continue;
    const set = openDays.get(e.storeId) ?? new Set<string>();
    for (const d of days.keys()) set.add(d);
    openDays.set(e.storeId, set);
  }

  // ── Narrow to the people asked for ──
  const q = filters.q?.toLowerCase();
  const people = allEmployees.filter(
    (e) =>
      (!filters.designation || e.designation === filters.designation) &&
      (!q || e.name.toLowerCase().includes(q) || e.staffCode.toLowerCase().includes(q)),
  );
  if (people.length === 0) return empty;

  // Refuse absurdly large selections before building anything.
  const spanDays = Math.round((Date.parse(`${effectiveTo}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000) + 1;
  if (people.length * spanDays > MAX_REPORT_ROWS) throw new ReportTooLargeError(people.length * spanDays);

  // ── Manual entries + payroll monthly OT ──
  const manualIds = people.filter((e) => storeById.get(e.storeId)!.mode === 'MANUAL').map((e) => e.id);
  const manualEntries = manualIds.length
    ? await prisma.manualAttendanceEntry.findMany({
        where: {
          employeeId: { in: manualIds },
          date: { gte: new Date(`${period.from}T00:00:00Z`), lte: new Date(`${effectiveTo}T00:00:00Z`) },
        },
        select: { employeeId: true, date: true, status: true, checkInTime: true, checkOutTime: true, otHours: true },
      })
    : [];
  const entryByKey = new Map(manualEntries.map((e) => [`${e.employeeId}|${e.date.toISOString().slice(0, 10)}`, e]));

  const otRows = await prisma.employeeMonthlyOvertime.findMany({
    where: {
      employeeId: { in: people.map((p) => p.id) },
      period: {
        storeId: { in: stores.map((s) => s.id) },
        OR: period.months.map((ym) => ({ periodYear: Number(ym.slice(0, 4)), periodMonth: Number(ym.slice(5, 7)) })),
      },
    },
    select: { employeeId: true, totalHours: true, period: { select: { periodYear: true, periodMonth: true } } },
  });
  // A payroll monthly total is for the WHOLE month, so it only counts when the period covers the
  // whole month. For a part-month custom range that month falls back to the daily entries.
  const monthlyOt: MonthlyOt = new Map();
  for (const o of otRows) {
    const ym = `${o.period.periodYear}-${String(o.period.periodMonth).padStart(2, '0')}`;
    const monthStart = `${ym}-01`;
    const monthEnd = addDays(`${nextMonth(ym)}-01`, -1);
    if (monthStart >= period.from && monthEnd <= period.to) monthlyOt.set(`${o.employeeId}|${ym}`, Number(o.totalHours));
  }

  // ── Build one row per person per day ──
  const records: DayRecord[] = [];
  for (const e of people) {
    const store = storeById.get(e.storeId)!;
    const joined = e.dateOfJoining ? dateKeyZone(e.dateOfJoining) : period.from;
    const relieved = e.dateOfRelieving ? dateKeyZone(e.dateOfRelieving) : effectiveTo;
    const start = joined > period.from ? joined : period.from;
    const end = relieved < effectiveTo ? relieved : effectiveTo;
    const fillGaps = e.status === 'ACTIVE'; // people who left only show days that have real data
    const base = {
      employeeId: e.id, staffCode: e.staffCode, name: e.name, designation: e.designation,
      storeId: store.id, storeName: store.name, clientId: store.clientId, clientName: store.clientName, mode: store.mode,
    };

    if (store.mode === 'MANUAL') {
      for (let day = start; day <= end; day = addDays(day, 1)) {
        const entry = entryByKey.get(`${e.id}|${day}`);
        if (!entry && !fillGaps) continue;
        let measured: number | null = null;
        if (entry?.checkInTime && entry.checkOutTime) {
          // Both times are stored on the entry's own date, so an overnight shift (in 22:00, out 07:00)
          // has an "earlier" check-out — it means the next morning.
          let ms = entry.checkOutTime.getTime() - entry.checkInTime.getTime();
          if (ms < 0) ms += 24 * 3_600_000;
          if (ms > 0) measured = round2(ms / 3_600_000);
        }
        const { hours, notes } = applyHoursRules({
          checkedIn: entry?.status === 'PRESENT' && !!entry.checkInTime,
          checkedOut: !!entry?.checkOutTime,
          measuredHours: measured,
        });
        records.push({
          ...base, date: day,
          status: (entry?.status ?? 'NOT_RECORDED') as DayStatus,
          checkIn: entry?.checkInTime ? hhmmLocal(entry.checkInTime) : null,
          checkOut: entry?.checkOutTime ? hhmmLocal(entry.checkOutTime) : null,
          hours, otHours: entry?.otHours ? Number(entry.otHours) : 0, punches: null, notes,
        });
      }
    } else {
      const days = punchesByCode.get(e.staffCode);
      const open = openDays.get(store.id);
      for (let day = start; day <= end; day = addDays(day, 1)) {
        const p = days?.get(day);
        if (p) {
          records.push({
            ...base, date: day, status: 'PRESENT',
            checkIn: hhmmZone(p.first), checkOut: p.punches >= 2 ? hhmmZone(p.last) : null,
            hours: p.hours === null ? null : round2(p.hours),
            otHours: 0, // recorded OT only — biometric punches carry none, and nothing is estimated
            punches: p.punches,
            notes: p.autoClosed > 0 ? ['NO_CHECKOUT'] : [],
          });
        } else if (fillGaps && open?.has(day)) {
          records.push({
            ...base, date: day, status: 'NO_PUNCH', checkIn: null, checkOut: null, hours: null, otHours: 0, punches: 0, notes: [],
          });
        }
      }
    }
  }

  records.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return { period, effectiveTo, scopeStores, records, monthlyOt };
}
