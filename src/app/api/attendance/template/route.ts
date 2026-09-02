import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { generateAttendanceTemplateCsv, type OtTemplateMode } from '@/lib/attendance/csv';
import { toUserMessage } from '@/lib/errors';

/**
 * GET /api/attendance/template?storeId=...&year=2026&month=8&otMode=daily|total
 *
 * Downloads a pre-filled wide-format attendance CSV for a store+month —
 * ECode, Name, one column per calendar date, and either paired "N_OT"
 * columns (otMode=daily) or a trailing "OT_Hours" column (otMode=total).
 * See spec §5.1.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId');
  const year = Number(searchParams.get('year'));
  const month = Number(searchParams.get('month'));
  const otMode = (searchParams.get('otMode') ?? 'total') as OtTemplateMode;

  if (!storeId || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'storeId, year, and month (1-12) are required.' }, { status: 400 });
  }
  if (otMode !== 'daily' && otMode !== 'total') {
    return NextResponse.json({ error: 'otMode must be "daily" or "total".' }, { status: 400 });
  }

  try {
    const session = await requireAuth('attendance:csvUpload', { storeId });

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true, clientId: true },
    });
    if (!store) {
      return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
    }
    if (session.user.role === 'CLIENT' && session.user.clientId !== store.clientId) {
      return NextResponse.json({ error: 'Not authorized for this store.' }, { status: 403 });
    }

    const employees = await prisma.employee.findMany({
      where: { storeId, status: 'ACTIVE' },
      select: { staffCode: true, name: true },
      orderBy: { staffCode: 'asc' },
    });

    const csv = generateAttendanceTemplateCsv(employees, year, month, otMode);
    const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
    const safeStoreName = store.name.replace(/[^a-z0-9]+/gi, '-');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="attendance-${safeStoreName}-${monthLabel}-${otMode}.csv"`,
      },
    });
  } catch (err) {
    const message = toUserMessage(err);
    const status = message.toLowerCase().includes('permission') || message.toLowerCase().includes('signed in') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
