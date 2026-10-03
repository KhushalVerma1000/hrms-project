/**
 * Salary engine — pure functions, no database, no framework.
 *
 * Money is whole rupees (the payout sheet works in whole rupees). Every figure is
 * rounded half-up at the point it is produced, exactly as the payout sheet shows it,
 * so the sheet's own columns always add up.
 *
 * Column logic was reverse-engineered from the client's sample payout row (bonus pay is part of
 * gross by the client's later instruction) and is
 * pinned by engine.test.ts. Anything that is a policy choice rather than something
 * the sample proves is marked ASSUMPTION and lives in ClientPayrollConfig / SalarySlab
 * so it can be changed without touching this file.
 */

/** One slab: the fixed MONTHLY amounts for a person (or for all of a client's Associates). */
export interface SlabAmounts {
  basic: number;
  hra: number;
  specialAllowance: number;
  travellingAllowance: number;
  /** Rupees per overtime full day. null → ASSUMPTION: full-month fixed gross ÷ days in month. */
  otDayRate: number | null;
  /** Rupees per overtime hour. null → ASSUMPTION: otDayRate ÷ shiftHours. */
  otHourRate: number | null;
  /** Rupees per bonus day. null → ASSUMPTION: same as the OT day rate. */
  bonusDayRate: number | null;
}

/** Statutory + policy settings for one client. Percentages are plain numbers (12 = 12 %). */
export interface PayrollConfig {
  pfEmployeePct: number;      // 12
  pfEmployerPct: number;      // 12 (EPF 3.67 + EPS 8.33)
  pfAdminPct: number;         // 1  (0.5 EPFO admin + 0.5 EDLI) — the sample's 150 on 15,000
  /** PF is calculated on min(basic + special allowance, ceiling). null = no ceiling. */
  pfWageCeiling: number | null;
  esicEmployeePct: number;    // 0.75
  esicEmployerPct: number;    // 3.25
  /**
   * ESIC applies only while the month's ESIC wages (prorated basic + special allowance) are at or
   * below this. (Field keeps its original name so older saved settings and drafts still load.)
   */
  esicGrossLimit: number;     // 21000
  insurance: number;          // fixed rupees per month (employer)
  pt: number;                 // professional tax, rupees per month (employee)
  lwf: number;                // labour welfare fund, rupees per month (employee)
}

export interface AttendanceInput {
  presentDays: number;
  /** Week-offs and paid holidays — both are paid days. */
  weekOffDays: number;
  halfDays: number;
  absentDays: number;
  otFullDays: number;
  otHours: number;
  bonusDays: number;
}

export interface CalcContext {
  daysInMonth: number;
  /** Standard shift length, used to turn the OT day rate into an hourly rate. */
  shiftHours: number;
}

export interface PayrollResult {
  salariedDays: number;
  /** Full-month fixed amounts (sheet: "employee salary", "employee HRA"). */
  fullBasic: number;
  fullHra: number;
  /** Prorated by salariedDays ÷ daysInMonth. */
  basic: number;
  hra: number;
  specialAllowance: number;
  travellingAllowance: number;
  overtime: number;
  bonusPay: number;
  /** basic + hra + special + travelling + overtime + bonusPay. */
  gross: number;
  pfEmployer: number;
  esicEmployer: number;
  pfAdmin: number;
  insurance: number;
  totalEmployer: number;
  /** gross + totalEmployer (bonus pay is already inside gross). */
  fixedCtc: number;
  pfEmployee: number;
  esicEmployee: number;
  pt: number;
  lwf: number;
  totalDeduction: number;
  /** gross − totalDeduction. */
  netTakeHome: number;
  /** employee + employer + admin charges. */
  totalPf: number;
  /** employee + employer. */
  totalEsic: number;
  esicApplicable: boolean;
}

/** Round half-up to a whole rupee (the epsilon absorbs float noise like 487.49999999999994). */
export const roundRupee = (n: number): number => Math.floor(n + 0.5 + 1e-9);

export function calculatePayroll(
  slab: SlabAmounts,
  config: PayrollConfig,
  att: AttendanceInput,
  ctx: CalcContext,
): PayrollResult {
  const dim = ctx.daysInMonth;

  // ASSUMPTION: a paid day is present, week-off/holiday, or half a day per half-day.
  // Capped at the month so a data glitch can never pay more than the full fixed salary.
  const salariedDays = Math.min(dim, att.presentDays + att.weekOffDays + att.halfDays * 0.5);
  const ratio = dim > 0 ? salariedDays / dim : 0;
  const prorate = (monthly: number) => roundRupee(monthly * ratio);

  const basic = prorate(slab.basic);
  const hra = prorate(slab.hra);
  const specialAllowance = prorate(slab.specialAllowance);
  const travellingAllowance = prorate(slab.travellingAllowance);

  const fullGross = slab.basic + slab.hra + slab.specialAllowance + slab.travellingAllowance;
  const otDayRate = slab.otDayRate ?? roundRupee(fullGross / dim);
  const otHourRate = slab.otHourRate ?? roundRupee(otDayRate / ctx.shiftHours);
  const bonusDayRate = slab.bonusDayRate ?? otDayRate;

  const overtime = roundRupee(att.otFullDays * otDayRate + att.otHours * otHourRate);
  const bonusPay = roundRupee(att.bonusDays * bonusDayRate);

  const gross = basic + hra + specialAllowance + travellingAllowance + overtime + bonusPay;

  // PF and ESIC wages = prorated basic + special allowance, nothing else. Overtime and bonus pay
  // are part of gross (what the person is paid) but are never in these wages; HRA and the
  // travelling allowance are excluded too. ASSUMPTION: no 50 % add-back is applied (client's call).
  const statutoryWage = basic + specialAllowance;
  const pfWage = config.pfWageCeiling == null ? statutoryWage : Math.min(statutoryWage, config.pfWageCeiling);
  const pfEmployee = roundRupee((pfWage * config.pfEmployeePct) / 100);
  const pfEmployer = roundRupee((pfWage * config.pfEmployerPct) / 100);
  const pfAdmin = roundRupee((pfWage * config.pfAdminPct) / 100);

  const esicApplicable = statutoryWage > 0 && statutoryWage <= config.esicGrossLimit;
  const esicWage = statutoryWage;
  const esicEmployee = esicApplicable ? roundRupee((esicWage * config.esicEmployeePct) / 100) : 0;
  const esicEmployer = esicApplicable ? roundRupee((esicWage * config.esicEmployerPct) / 100) : 0;

  // Nothing payable → no flat charges either.
  const worked = salariedDays > 0;
  const insurance = worked ? config.insurance : 0;
  const pt = worked ? config.pt : 0;
  const lwf = worked ? config.lwf : 0;

  const totalEmployer = pfEmployer + esicEmployer + pfAdmin + insurance;
  const fixedCtc = gross + totalEmployer;
  const totalDeduction = pfEmployee + esicEmployee + pt + lwf;
  const netTakeHome = gross - totalDeduction;

  return {
    salariedDays, fullBasic: slab.basic, fullHra: slab.hra,
    basic, hra, specialAllowance, travellingAllowance, overtime, bonusPay, gross,
    pfEmployer, esicEmployer, pfAdmin, insurance, totalEmployer, fixedCtc,
    pfEmployee, esicEmployee, pt, lwf, totalDeduction, netTakeHome,
    totalPf: pfEmployee + pfEmployer + pfAdmin,
    totalEsic: esicEmployee + esicEmployer,
    esicApplicable,
  };
}

export const DEFAULT_PAYROLL_CONFIG: PayrollConfig = {
  pfEmployeePct: 12, pfEmployerPct: 12, pfAdminPct: 1, pfWageCeiling: 15000,
  esicEmployeePct: 0.75, esicEmployerPct: 3.25, esicGrossLimit: 21000,
  insurance: 0, pt: 0, lwf: 0,
};
