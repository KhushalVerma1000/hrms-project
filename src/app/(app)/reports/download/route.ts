import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { can } from '@/lib/auth/can';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { loadReport, ReportTooLargeError, todayKey } from '@/lib/reports/data';
import { parseFilters, REPORT_KINDS, type ReportKind } from '@/lib/reports/filters';
import { buildReport, describeFilters, musterAvailable } from '@/lib/reports/export';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /reports/download?report=records|employees|stores|muster&<same filters as the page>
 *
 * Scope is decided server-side from the session (loadReport → storeScopeWhere); filters in
 * the URL can only narrow it. Every download is audit-logged.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Sign in to download reports.' }, { status: 401 });
  if (!can(session, 'reports:view', {})) {
    return NextResponse.json({ error: 'Your role cannot download reports.' }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const kind = sp.get('report') as ReportKind | null;
  if (!kind || !REPORT_KINDS.includes(kind)) {
    return NextResponse.json({ error: 'Unknown report type.' }, { status: 400 });
  }

  const today = todayKey();
  const filters = parseFilters((k) => sp.get(k) ?? undefined, today);

  let data;
  try {
    data = await loadReport(session, filters, today);
  } catch (err) {
    if (err instanceof ReportTooLargeError) return NextResponse.json({ error: err.message }, { status: 413 });
    console.error('[reports] download failed', err);
    return NextResponse.json({ error: 'Could not build the report. Please try again.' }, { status: 500 });
  }

  if (kind === 'muster' && !musterAvailable(data.period)) {
    return NextResponse.json(
      { error: 'The muster roll is only available for periods of 31 days or less. Pick a single month or a shorter range.' },
      { status: 400 },
    );
  }

  const clientName = data.scopeStores.find((s) => s.clientId === filters.clientId)?.clientName;
  const storeName = data.scopeStores.find((s) => s.id === filters.storeId)?.name;
  const preamble = [
    `Attendance report: ${kind}`,
    ...describeFilters(filters, data.period, { client: clientName, store: storeName }),
    `Generated: ${new Date().toISOString()} by ${session.user.email ?? session.user.name ?? 'user'}`,
  ];
  const built = buildReport(kind, data.records, data.monthlyOt, data.period, filters, preamble);

  await writeAuditLog({
    userId: session.user.id,
    action: 'REPORT_DOWNLOADED',
    targetType: 'Report',
    targetId: kind,
    metadata: { period: data.period.label, from: data.period.from, to: data.period.to, rows: built.rowCount, filters: { ...filters, period: undefined } },
  }).catch((e) => console.error('[reports] audit log failed', e)); // never block the download on logging

  return new NextResponse(built.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${built.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
