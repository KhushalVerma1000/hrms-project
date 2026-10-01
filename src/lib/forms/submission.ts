import { createHash, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/** Keys a sender might use for the employee code (top level, or a form question title). */
const CODE_KEYS = /^(staff[\s_-]?code|employee[\s_-]?code|e[\s_-]?code|ecode)$/i;

/** Pulls the employee code out of a webhook body, tolerating different field names. */
export function extractStaffCode(body: any): string | null {
  const clean = (v: unknown) => {
    const raw = Array.isArray(v) ? v[0] : v;
    return typeof raw === 'string' || typeof raw === 'number' ? String(raw).replace(/\s+/g, '') : '';
  };
  const search = (obj: any): string | null => {
    if (!obj || typeof obj !== 'object') return null;
    for (const [k, v] of Object.entries(obj)) {
      if (CODE_KEYS.test(k.trim())) {
        const c = clean(v);
        if (c) return c;
      }
    }
    return null;
  };
  // Explicit field first, then top-level aliases, then the raw form answers.
  return clean(body?.employeeCode) || search(body) || search(body?.rawValues) || null;
}

/** Constant-time check of the X-Webhook-Secret header. The secret is REQUIRED. */
export function checkWebhookSecret(request: NextRequest): 'ok' | 'unauthorized' | 'not_configured' {
  const expected = process.env.FORM_WEBHOOK_SECRET;
  if (!expected) return 'not_configured';
  const given = request.headers.get('X-Webhook-Secret') ?? '';
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b) ? 'ok' : 'unauthorized';
}

export type SubmissionResult =
  | { status: 'recorded'; employeeId: string; name: string }
  | { status: 'already_submitted'; employeeId: string; name: string }
  | { status: 'unmatched'; reason: 'no_code' | 'no_employee' };

/**
 * Records a Google Form submission against an employee, or parks it in the
 * unmatched list for an admin to reconcile. Safe to call twice for the same
 * submission: the first submission time is kept.
 */
export async function recordFormSubmission(p: {
  staffCode: string | null;
  submittedAt?: Date;
  rawPayload: object;
  formId?: string | null;
}): Promise<SubmissionResult> {
  // A bad or future timestamp from the sender must not poison the record.
  const now = new Date();
  const at = p.submittedAt && !isNaN(p.submittedAt.getTime()) && p.submittedAt <= now ? p.submittedAt : now;

  const park = async (reason: 'no_code' | 'no_employee') => {
    await prisma.unmatchedFormSubmission.create({
      data: {
        rawPayload: p.rawPayload,
        submittedAt: at,
        staffCodeGuess: p.staffCode,
        formId: p.formId?.slice(0, 200) || null,
      },
    });
    return { status: 'unmatched', reason } as const;
  };

  if (!p.staffCode) return park('no_code');

  const employee = await prisma.employee.findUnique({
    where: { staffCode: p.staffCode },
    select: { id: true, name: true, onboardingFormStatus: true },
  });
  if (!employee) return park('no_employee');

  if (employee.onboardingFormStatus === 'SUBMITTED') {
    return { status: 'already_submitted', employeeId: employee.id, name: employee.name };
  }
  await prisma.employee.update({
    where: { id: employee.id },
    data: {
      onboardingFormStatus: 'SUBMITTED',
      onboardingFormSubmittedAt: at,
      onboardingFormSubmittedVia: 'WEBHOOK',
    },
  });
  return { status: 'recorded', employeeId: employee.id, name: employee.name };
}

/** Shared POST handler for both webhook URLs. */
export async function handleFormWebhook(request: NextRequest): Promise<NextResponse> {
  const auth = checkWebhookSecret(request);
  if (auth === 'not_configured') {
    console.error('[FormWebhook] FORM_WEBHOOK_SECRET is not set — refusing all requests');
    return NextResponse.json({ error: 'Webhook is not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    console.warn('[FormWebhook] Invalid webhook secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await recordFormSubmission({
      staffCode: extractStaffCode(body),
      submittedAt: body.submittedAt ? new Date(body.submittedAt) : undefined,
      rawPayload: body,
      formId: typeof body.formId === 'string' ? body.formId : null,
    });

    // Always 200 once we've handled it (even if unmatched) so the sender doesn't retry-storm.
    if (result.status === 'unmatched') {
      console.warn(`[FormWebhook] Unmatched submission (${result.reason})`);
      return NextResponse.json({
        ok: false,
        message:
          result.reason === 'no_code'
            ? 'No employee code in submission — saved for admin review'
            : 'No employee found for that code — saved for admin review',
      });
    }
    return NextResponse.json({
      ok: true,
      message:
        result.status === 'recorded'
          ? `Form submission recorded for ${result.name}`
          : `Form was already recorded for ${result.name}`,
      employeeId: result.employeeId,
    });
  } catch (err: any) {
    console.error('[FormWebhook] Failed to record submission', err);
    // 500 so the Apps Script retries.
    return NextResponse.json({ ok: false, error: 'Failed to record submission' }, { status: 500 });
  }
}
