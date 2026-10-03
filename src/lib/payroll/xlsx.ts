import ExcelJS from 'exceljs';
import type { PayrollConfig, PayrollResult } from './engine';
import type { LineIdentity, LineInputs } from './service';

export interface SheetLine {
  identity: LineIdentity;
  inputs: LineInputs;
  result: PayrollResult | null;
}

const pct = (n: number) => String(Number(n.toFixed(4)));

/** The payout sheet's headers, in the client's order and wording (typos included, on purpose). */
export function payoutHeaders(c: PayrollConfig): string[] {
  return [
    'store', 'Sno.', 'store series', 'Ecode', 'Employee name', 'Father Name', 'UAN', 'ESIC', 'Designation', 'STATUS',
    'present full day', 'WEEK OFF', 'half day', 'Absent', 'Overtime full days', 'overtime (hours)', 'Bonus days',
    'Total salaried days', 'Column 1', 'Basic', 'HRA', 'employee salary', 'employee HRA', 'Special Allowance',
    'Travelling Allowance', 'overtime', 'Bonus pay', 'Gross', 'PF Emplyr', `ESI ${pct(c.esicEmployerPct)}% of BASIC`,
    'PF Admin Charges', 'INSURANCE', 'TOTAL Employer', 'Fixed CTC', `PF ${pct(c.pfEmployeePct)}% of BASIC`,
    `ESI ${pct(c.esicEmployeePct)}% BASIC`, 'PT', 'LWF', 'TOTAL DIDUCTION', 'NET TAKE HOME', 'total pf', 'total esic',
  ];
}

const TEXT_COLS = new Set([4, 7, 8]); // Ecode, UAN, ESIC — long digit strings must never become 1.2E+13

export async function buildPayoutWorkbook(lines: SheetLine[], config: PayrollConfig, title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Payout', { views: [{ state: 'frozen', xSplit: 5, ySplit: 2 }] });
  const headers = payoutHeaders(config);

  ws.addRow([title]);
  ws.getRow(1).font = { bold: true, size: 13 };
  const head = ws.addRow(headers);
  head.font = { bold: true };
  head.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  head.height = 32;

  const sorted = [...lines].sort(
    (a, b) => a.identity.storeName.localeCompare(b.identity.storeName) || a.identity.staffCode.localeCompare(b.identity.staffCode),
  );
  const perStore = new Map<string, number>();
  const sums = new Array<number>(headers.length).fill(0);

  sorted.forEach((l, i) => {
    const { identity: id, inputs: inp, result: r } = l;
    const series = (perStore.get(id.storeName) ?? 0) + 1;
    perStore.set(id.storeName, series);
    const a = inp.attendance;
    const m = inp.manual;
    const label = id.designation.replace(/_/g, ' ');
    const status = id.status.charAt(0) + id.status.slice(1).toLowerCase();

    const row: (string | number | null)[] = [
      id.storeName, i + 1, series, id.staffCode, id.name, id.fatherName ?? '', id.uan ?? '', id.esicNumber ?? '', label, status,
      a.presentDays, a.weekOffDays, a.halfDays, a.absentDays, m.otFullDays, m.otHours ?? a.otHours, m.bonusDays,
      r?.salariedDays ?? null, null,
      r?.basic ?? null, r?.hra ?? null, r?.fullBasic ?? null, r?.fullHra ?? null, r?.specialAllowance ?? null,
      r?.travellingAllowance ?? null, r?.overtime ?? null, r?.bonusPay ?? null, r?.gross ?? null,
      r?.pfEmployer ?? null, r?.esicEmployer ?? null, r?.pfAdmin ?? null, r?.insurance ?? null, r?.totalEmployer ?? null,
      r?.fixedCtc ?? null, r?.pfEmployee ?? null, r?.esicEmployee ?? null, r?.pt ?? null, r?.lwf ?? null,
      r?.totalDeduction ?? null, r?.netTakeHome ?? null, r?.totalPf ?? null, r?.totalEsic ?? null,
    ];
    const xr = ws.addRow(row);
    row.forEach((v, idx) => {
      const col = idx + 1;
      if (TEXT_COLS.has(col)) { xr.getCell(col).value = String(v ?? ''); xr.getCell(col).numFmt = '@'; }
      // Sums: everything from "present full day" onward, except the unused "Column 1".
      if (col >= 11 && col !== 19 && typeof v === 'number') sums[idx] += v;
    });
    if (!r) xr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
  });

  const total = ws.addRow(headers.map((_, idx) => (idx === 0 ? 'TOTAL' : idx >= 10 && idx !== 18 ? sums[idx] : null)));
  total.font = { bold: true };
  total.border = { top: { style: 'thin' } };

  const widths: Record<number, number> = { 1: 18, 2: 6, 3: 8, 4: 18, 5: 24, 6: 24, 7: 15, 8: 15, 9: 18 };
  for (let c = 1; c <= headers.length; c++) ws.getColumn(c).width = widths[c] ?? 13;
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: headers.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
