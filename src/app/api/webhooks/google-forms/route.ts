import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OnboardingFormStatus } from '@prisma/client';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Extract staffCode from payload — standard key names or Google Form entry fields
    const staffCodeRaw =
      body.staffCode ||
      body.staff_code ||
      body.employeeCode ||
      body['Employee Code'] ||
      body['E-Code'];

    const staffCode = typeof staffCodeRaw === 'string' ? staffCodeRaw.trim() : null;

    if (!staffCode) {
      await prisma.unmatchedFormSubmission.create({
        data: {
          rawPayload: body,
          submittedAt: new Date(),
          staffCodeGuess: null,
        },
      });
      return NextResponse.json({ ok: false, message: 'No staffCode found in payload, saved to unmatched list.' }, { status: 400 });
    }

    const employee = await prisma.employee.findUnique({
      where: { staffCode },
    });

    if (!employee) {
      await prisma.unmatchedFormSubmission.create({
        data: {
          rawPayload: body,
          submittedAt: new Date(),
          staffCodeGuess: staffCode,
        },
      });
      return NextResponse.json({ ok: false, message: `No employee found with staffCode ${staffCode}, saved to unmatched list.` }, { status: 404 });
    }

    // Match found! Update employee onboarding form status
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        onboardingFormStatus: OnboardingFormStatus.SUBMITTED,
        onboardingFormSubmittedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, message: `Employee ${staffCode} onboarding paperwork confirmed submitted.` });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || 'Webhook processing failed' }, { status: 500 });
  }
}
