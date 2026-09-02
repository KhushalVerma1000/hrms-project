import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ensureCurrentPeriodsExist } from '@/lib/attendance/period';

/**
 * POST /api/attendance/periods/tick
 *
 * Opens the current month's AttendancePeriod for every store (idempotent —
 * getOrCreatePeriod no-ops if it already exists) and flips any OPEN/
 * LATE_GRANTED period whose deadline has passed to MISSED. Not strictly
 * required for correctness (getOrCreatePeriod does this lazily on access
 * too — see src/lib/attendance/period.ts), but running it daily means an
 * Admin's "missed periods" view stays current even for stores nobody has
 * opened today. Add to vercel.json's cron schedule alongside the existing
 * /api/sync/attendance job — once daily is enough (unlike the 15-min
 * attendance sync).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const headerSecret = request.headers.get('X-Cron-Secret');
    if (headerSecret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await ensureCurrentPeriodsExist();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[AttendancePeriods] Tick failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
