// Run with: npm run test:payroll
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculatePayroll, DEFAULT_PAYROLL_CONFIG, type SlabAmounts } from './engine';

const slab: SlabAmounts = {
  basic: 15000, hra: 3568, specialAllowance: 0, travellingAllowance: 0,
  otDayRate: null, otHourRate: null, bonusDayRate: 537,
};
const att = { presentDays: 27, weekOffDays: 4, halfDays: 0, absentDays: 0, otFullDays: 0, otHours: 0, bonusDays: 1 };

test('reproduces the client sample payout row (bonus pay inside gross; CTC and net unchanged)', () => {
  const r = calculatePayroll(slab, DEFAULT_PAYROLL_CONFIG, att, { daysInMonth: 31, shiftHours: 9 });
  assert.equal(r.salariedDays, 31);
  assert.equal(r.basic, 15000);
  assert.equal(r.hra, 3568);
  assert.equal(r.bonusPay, 537);
  assert.equal(r.gross, 19105); // bonus pay (537) is part of gross
  assert.equal(r.salariedDays, 31);
  assert.equal(r.pfEmployer, 1800);
  assert.equal(r.esicEmployer, 488);
  assert.equal(r.pfAdmin, 150);
  assert.equal(r.totalEmployer, 2438);
  assert.equal(r.fixedCtc, 21543);
  assert.equal(r.pfEmployee, 1800);
  assert.equal(r.esicEmployee, 113);
  assert.equal(r.totalDeduction, 1913);
  assert.equal(r.netTakeHome, 17192);
  assert.equal(r.totalPf, 3750);
  assert.equal(r.totalEsic, 601);
});

test('prorates basic and HRA by salaried days', () => {
  const r = calculatePayroll(slab, DEFAULT_PAYROLL_CONFIG, { ...att, presentDays: 12, weekOffDays: 3, bonusDays: 0 }, { daysInMonth: 30, shiftHours: 9 });
  assert.equal(r.salariedDays, 15);
  assert.equal(r.basic, 7500);
  assert.equal(r.hra, 1784);
});

test('ESIC stops above the wage limit; PF stays capped at the ceiling', () => {
  const rich: SlabAmounts = { ...slab, basic: 20000, hra: 5000, specialAllowance: 1500 }; // wages 21,500 > 21,000
  const r = calculatePayroll(rich, DEFAULT_PAYROLL_CONFIG, { ...att, bonusDays: 0 }, { daysInMonth: 31, shiftHours: 9 });
  assert.equal(r.esicApplicable, false);
  assert.equal(r.esicEmployee + r.esicEmployer, 0);
  assert.equal(r.pfEmployee, 1800);
});

test('a person with no paid days gets no flat charges', () => {
  const cfg = { ...DEFAULT_PAYROLL_CONFIG, pt: 200, insurance: 50 };
  const r = calculatePayroll(slab, cfg, { ...att, presentDays: 0, weekOffDays: 0, bonusDays: 0 }, { daysInMonth: 31, shiftHours: 9 });
  assert.equal(r.netTakeHome, 0);
  assert.equal(r.pt, 0);
});

test('PF and ESIC use prorated basic + special allowance only; OT, bonus, HRA and travel are out', () => {
  const s: SlabAmounts = { basic: 10000, hra: 4000, specialAllowance: 2000, travellingAllowance: 1500, otDayRate: 700, otHourRate: 80, bonusDayRate: 600 };
  const a = { presentDays: 26, weekOffDays: 4, halfDays: 0, absentDays: 0, otFullDays: 2, otHours: 5, bonusDays: 2 };
  const r = calculatePayroll(s, DEFAULT_PAYROLL_CONFIG, a, { daysInMonth: 30, shiftHours: 9 });
  assert.equal(r.overtime, 1800);       // 2×700 + 5×80
  assert.equal(r.bonusPay, 1200);       // 2×600
  assert.equal(r.gross, 10000 + 4000 + 2000 + 1500 + 1800 + 1200);
  assert.equal(r.pfEmployee, 1440);     // 12 % × 12,000
  assert.equal(r.pfEmployer, 1440);
  assert.equal(r.pfAdmin, 120);         // 1 % × 12,000
  assert.equal(r.esicEmployee, 90);     // 0.75 % × 12,000
  assert.equal(r.esicEmployer, 390);    // 3.25 % × 12,000
});

test('PF wage is capped at the ceiling after adding special allowance', () => {
  const s: SlabAmounts = { basic: 14000, hra: 0, specialAllowance: 3000, travellingAllowance: 0, otDayRate: null, otHourRate: null, bonusDayRate: null };
  const r = calculatePayroll(s, DEFAULT_PAYROLL_CONFIG, { ...att, bonusDays: 0 }, { daysInMonth: 31, shiftHours: 9 });
  assert.equal(r.pfEmployee, 1800);     // 12 % × 15,000 ceiling, not × 17,000
  assert.equal(r.esicApplicable, true); // 17,000 ≤ 21,000
  assert.equal(r.esicEmployee, 128);    // 0.75 % × 17,000 = 127.5
});

test('ESIC eligibility is tested on basic + special allowance, not on gross, OT or bonus', () => {
  const s: SlabAmounts = { basic: 15000, hra: 6000, specialAllowance: 0, travellingAllowance: 0, otDayRate: 900, otHourRate: null, bonusDayRate: 900 };
  const r = calculatePayroll(s, DEFAULT_PAYROLL_CONFIG, { ...att, otFullDays: 3, bonusDays: 2 }, { daysInMonth: 31, shiftHours: 9 });
  assert.ok(r.gross > 21000);           // 21,000 fixed + overtime + bonus
  assert.equal(r.esicApplicable, true); // wages are only 15,000
  assert.equal(r.esicEmployer, 488);
  const above: SlabAmounts = { ...s, basic: 20000, specialAllowance: 1500 };
  assert.equal(calculatePayroll(above, DEFAULT_PAYROLL_CONFIG, att, { daysInMonth: 31, shiftHours: 9 }).esicApplicable, false);
});
