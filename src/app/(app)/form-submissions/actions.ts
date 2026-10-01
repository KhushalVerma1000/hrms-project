'use server';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth/session';
import { writeAuditLog } from '@/lib/smartoffice/audit';

export interface UnmatchedSubmissionRow {
  id: string;
  submittedAt: Date;
  staffCodeGuess: string | null;
  formId: string | null;
  resolution: string | null;
  resolvedAt: Date | null;
  /** Human-readable question/answer pairs from the form, capped. */
  answers: { question: string; answer: string }[];
}

/** Flattens the stored payload into readable question/answer pairs. */
function toAnswers(raw: unknown): { question: string; answer: string }[] {
  const payload = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const source =
    payload.rawValues && typeof payload.rawValues === 'object' ? (payload.rawValues as Record<string, any>) : payload;
  const skip = new Set(['rawValues', 'formId', 'submittedAt', 'employeeCode']);
  return Object.entries(source)
    .filter(([k]) => source !== payload || !skip.has(k))
    .map(([question, v]) => {
      const first = Array.isArray(v) ? v[0] : v;
      const answer = typeof first === 'string' ? first : first == null ? '' : JSON.stringify(first);
      return { question: question.slice(0, 120), answer: answer.slice(0, 200) };
    })
    .filter((a) => a.answer !== '')
    .slice(0, 14);
}

export async function listUnmatchedSubmissionsAction(
  filter: 'OPEN' | 'RESOLVED' = 'OPEN',
): Promise<UnmatchedSubmissionRow[]> {
  await requireAuth('formSubmissions:manage');
  const rows = await prisma.unmatchedFormSubmission.findMany({
    where: filter === 'OPEN' ? { resolvedAt: null } : { resolvedAt: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    submittedAt: r.submittedAt,
    staffCodeGuess: r.staffCodeGuess,
    formId: r.formId,
    resolution: r.resolution,
    resolvedAt: r.resolvedAt,
    answers: toAnswers(r.rawPayload),
  }));
}

/** Finds employees to link a submission to (by name, e-code or mobile). */
export async function searchEmployeesForAssignAction(query: string) {
  await requireAuth('formSubmissions:manage');
  const q = query.trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, '');
  return prisma.employee.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { staffCode: { contains: q, mode: 'insensitive' } },
        ...(digits.length >= 4 ? [{ mobileNumber: { contains: digits } }] : []),
      ],
    },
    select: {
      id: true,
      staffCode: true,
      name: true,
      onboardingFormStatus: true,
      store: { select: { name: true, client: { select: { shortName: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
}

/** Links an unmatched submission to an employee and marks their form Submitted. */
export async function assignSubmissionAction(submissionId: string, employeeId: string) {
  const session = await requireAuth('formSubmissions:manage');

  const [submission, employee] = await Promise.all([
    prisma.unmatchedFormSubmission.findUnique({ where: { id: submissionId } }),
    prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, staffCode: true, name: true } }),
  ]);
  if (!submission) return { ok: false, error: 'Submission not found.' };
  if (submission.resolvedAt) return { ok: false, error: 'This submission was already resolved.' };
  if (!employee) return { ok: false, error: 'Employee not found.' };

  await prisma.$transaction([
    prisma.employee.update({
      where: { id: employee.id },
      data: {
        onboardingFormStatus: 'SUBMITTED',
        // Keep the earliest real submission time if one is already recorded.
        onboardingFormSubmittedAt: submission.submittedAt,
        onboardingFormSubmittedVia: 'ASSIGNED',
      },
    }),
    prisma.unmatchedFormSubmission.update({
      where: { id: submissionId },
      data: {
        resolvedAt: new Date(),
        resolvedByUserId: session.user.id,
        resolution: 'ASSIGNED',
        resolvedEmployeeId: employee.id,
      },
    }),
  ]);
  await writeAuditLog({
    userId: session.user.id,
    action: 'FORM_SUBMISSION_ASSIGNED',
    targetType: 'Employee',
    targetId: employee.id,
    metadata: { staffCode: employee.staffCode, submissionId },
  });
  return { ok: true, employeeName: employee.name };
}

export async function dismissSubmissionAction(submissionId: string) {
  const session = await requireAuth('formSubmissions:manage');
  const submission = await prisma.unmatchedFormSubmission.findUnique({ where: { id: submissionId } });
  if (!submission) return { ok: false, error: 'Submission not found.' };
  if (submission.resolvedAt) return { ok: true };

  await prisma.unmatchedFormSubmission.update({
    where: { id: submissionId },
    data: { resolvedAt: new Date(), resolvedByUserId: session.user.id, resolution: 'DISMISSED' },
  });
  await writeAuditLog({
    userId: session.user.id,
    action: 'FORM_SUBMISSION_DISMISSED',
    targetType: 'UnmatchedFormSubmission',
    targetId: submissionId,
    metadata: { staffCodeGuess: submission.staffCodeGuess },
  });
  return { ok: true };
}
