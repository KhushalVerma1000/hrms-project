import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { can } from '@/lib/auth/can';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { monthLabel } from '@/lib/reports/period';
import type { PayrollConfig, PayrollResult } from '@/lib/payroll/engine';
import { ymOf, type LineIdentity, type LineInputs } from '@/lib/payroll/service';
import { buildPayoutWorkbook } from '@/lib/payroll/xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /payroll/runs/:id/download — the payout sheet as .xlsx. Admin only; every download is audit-logged. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Sign in to download.' }, { status: 401 });
  if (!can(session, 'payroll:manage', {})) return NextResponse.json({ error: 'Payroll is restricted to administrators.' }, { status: 403 });

  const { id } = await params;
  const run = await prisma.payrollRun.findUnique({ where: { id }, include: { client: { select: { name: true } }, lines: true } });
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 });

  const ym = ymOf(run.periodYear, run.periodMonth);
  const title = `${run.client.name} — salary & compliance sheet — ${monthLabel(ym)}${run.status === 'DRAFT' ? ' (DRAFT)' : ''}`;
  const buf = await buildPayoutWorkbook(
    run.lines.map((l) => ({
      identity: l.identity as unknown as LineIdentity,
      inputs: l.inputs as unknown as LineInputs,
      result: l.result as unknown as PayrollResult | null,
    })),
    run.configSnapshot as unknown as PayrollConfig,
    title,
  );

  await writeAuditLog({ userId: session.user.id, action: 'PAYROLL_SHEET_DOWNLOAD', targetType: 'PayrollRun', targetId: id, metadata: { ym, status: run.status } });

  const safe = run.client.name.replace(/[^A-Za-z0-9]+/g, '_');
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Payroll_${safe}_${ym}${run.status === 'DRAFT' ? '_DRAFT' : ''}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
