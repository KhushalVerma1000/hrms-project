import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/webhooks/onboarding-form
 *
 * Receives form submission notifications from the Google Apps Script trigger
 * attached to the onboarding Google Form/Sheet.
 *
 * Security: Validates X-Webhook-Secret header against FORM_WEBHOOK_SECRET env var.
 *
 * On success: matches submission to Employee by staffCode, sets SUBMITTED status.
 * On no match: logs to UnmatchedFormSubmission for Admin reconciliation.
 *
 * Apps Script trigger code (attach to Form's linked Sheet):
 * ```javascript
 * function onFormSubmit(e) {
 *   const response = e.namedValues;
 *   const payload = {
 *     employeeCode: (response['Employee Code'] || [''])[0].trim(),
 *     respondentName: (response['Name'] || [''])[0],
 *     submittedAt: new Date().toISOString(),
 *     rawValues: response,
 *   };
 *   const options = {
 *     method: 'post',
 *     contentType: 'application/json',
 *     payload: JSON.stringify(payload),
 *     headers: { 'X-Webhook-Secret': 'YOUR_FORM_WEBHOOK_SECRET' },
 *     muteHttpExceptions: true,
 *   };
 *   UrlFetchApp.fetch('https://your-app.vercel.app/api/webhooks/onboarding-form', options);
 * }
 * ```
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Validate webhook secret
  const webhookSecret = process.env.FORM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const headerSecret = request.headers.get('X-Webhook-Secret');
    if (headerSecret !== webhookSecret) {
      console.warn('[FormWebhook] Invalid webhook secret');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: {
    employeeCode?: string;
    respondentName?: string;
    submittedAt?: string;
    rawValues?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const staffCode = body.employeeCode?.trim();
  const submittedAt = body.submittedAt ? new Date(body.submittedAt) : new Date();

  if (!staffCode) {
    // No employee code — log as unmatched
    await prisma.unmatchedFormSubmission.create({
      data: {
        rawPayload: body as object,
        submittedAt,
        staffCodeGuess: null,
      },
    });
    console.warn('[FormWebhook] Submission received with no employee code');
    return NextResponse.json({ ok: false, message: 'No employee code in submission' });
  }

  // Find matching employee
  const employee = await prisma.employee.findUnique({
    where: { staffCode },
    select: { id: true, name: true, onboardingFormStatus: true },
  });

  if (!employee) {
    // No matching employee — log as unmatched for Admin reconciliation
    await prisma.unmatchedFormSubmission.create({
      data: {
        rawPayload: body as object,
        submittedAt,
        staffCodeGuess: staffCode,
      },
    });
    console.warn(`[FormWebhook] No employee found for staffCode: ${staffCode}`);
    return NextResponse.json({
      ok: false,
      message: `No employee found for code ${staffCode} — logged for reconciliation`,
    });
  }

  // Update employee form status
  await prisma.employee.update({
    where: { id: employee.id },
    data: {
      onboardingFormStatus: 'SUBMITTED',
      onboardingFormSubmittedAt: submittedAt,
    },
  });

  console.log(`[FormWebhook] Form submitted for employee ${employee.name} (${staffCode})`);
  return NextResponse.json({
    ok: true,
    message: `Form submission recorded for employee ${employee.name}`,
    employeeId: employee.id,
  });
}
