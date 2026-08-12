import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { runAttendanceSync } from '@/lib/sync/attendance';

/**
 * POST /api/sync/attendance
 *
 * Triggered by Vercel Cron (every 15 min via vercel.json) or manually.
 * Protected by CRON_SECRET header to prevent unauthorized triggering.
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
    const result = await runAttendanceSync();
    return NextResponse.json({
      ok: true,
      message: `Sync complete. Processed ${result.devicesProcessed} devices, upserted ${result.logsUpserted} logs.`,
      ...result,
    });
  } catch (err) {
    console.error('[Sync] Attendance sync failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
