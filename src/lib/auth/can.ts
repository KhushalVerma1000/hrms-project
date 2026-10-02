import type { Session } from 'next-auth';
import type { Role } from '@prisma/client';

/**
 * All actions that can be checked via can().
 * Covers every capability in the permission matrix (Section 2 of the spec).
 */
export type Action =
  | 'employee:create'
  | 'employee:edit'
  | 'employee:softDelete'
  | 'employee:hardDelete'
  | 'employee:view'
  | 'attendance:view'
  | 'reports:view'
  | 'attendance:manualEntry'
  | 'attendance:facePunch'
  | 'attendance:faceEnroll'
  | 'attendance:csvUpload'
  | 'attendance:lateAccess:request'
  | 'attendance:lateAccess:approve'
  | 'attendance:deadlinePolicy:manage'
  | 'device:manage'
  | 'store:create'
  | 'store:manage'
  | 'client:create'
  | 'client:manage'
  | 'user:manage'
  | 'masterData:manage'
  | 'auditLog:view'
  | 'syncIssues:view'
  | 'syncIssues:retry'
  | 'formTracking:view'
  | 'formTracking:remind'
  | 'formSubmissions:manage'
  | 'onboardingForm:editClient'
  | 'onboardingForm:editStore';

/**
 * Roles allowed to change onboarding Google Form links. Admin only for now.
 * To let clients (client-wide default) and/or managers (their own store's
 * override) manage their own links later, add 'CLIENT' and/or 'MANAGER' here —
 * the scoping below (own client / own store) is already in place.
 */
const ONBOARDING_FORM_EDITOR_ROLES: readonly Role[] = ['ADMIN'];

/**
 * Context for scoped permission checks.
 * storeId and clientId should be the IDs of the resource being acted on.
 */
export interface PermissionContext {
  storeId?: string | null;
  clientId?: string | null;
}

/**
 * The single authorisation gate for the entire application.
 *
 * This function implements the full permission matrix from Section 2 of the spec.
 * It must be called at the top of EVERY server action and route handler that
 * performs a privileged operation — never rely on hiding UI elements alone.
 *
 * @param session - The current user session (from auth())
 * @param action  - The action being attempted
 * @param ctx     - Optional scope context (storeId / clientId of the target resource)
 * @returns true if the action is allowed, false otherwise
 *
 * @example
 * const session = await auth();
 * if (!can(session, 'employee:hardDelete', { storeId: employee.storeId })) {
 *   throw new AuthorizationError();
 * }
 */
export function can(
  session: Session | null,
  action: Action,
  ctx: PermissionContext = {},
): boolean {
  if (!session?.user) return false;

  const { role, storeId: sessionStoreId, clientId: sessionClientId } = session.user;

  // ─── Helper: check if the resource is within the caller's scope ───
  const inStore = (resourceStoreId?: string | null) =>
    !resourceStoreId || sessionStoreId === resourceStoreId;

  const inClient = (resourceClientId?: string | null) =>
    !resourceClientId || sessionClientId === resourceClientId;

  // ─── Permission matrix ─────────────────────────────────────────────────
  switch (action) {
    // ── Employee operations ─────────────────────────────────────────────
    case 'employee:view':
    case 'employee:create':
    case 'employee:edit':
    case 'employee:softDelete':
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return inClient(ctx.clientId);
        case 'MANAGER':
        case 'PROCESS_ASSOCIATE':
        case 'SHIFT_INCHARGE': return inStore(ctx.storeId);
        default: return false;
      }

    case 'employee:hardDelete':
      // Full delete: Admin only unrestricted. Manager has 30-day attendance guard
      // (enforced separately in the server action, not here). PA/SI: never.
      switch (role) {
        case 'ADMIN': return true;
        // CLIENT cannot hard-delete (spec: "Client: ❌" for hard delete)
        case 'CLIENT': return false;
        case 'MANAGER': return inStore(ctx.storeId); // attendance guard checked separately
        default: return false;
      }

    // ── Attendance ──────────────────────────────────────────────────
    case 'attendance:view':
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return inClient(ctx.clientId);
        case 'MANAGER': return inStore(ctx.storeId);
        // PA/SI: no access to attendance
        default: return false;
      }

    // Attendance reports (view + download). Office roles: Admin sees everything, Client sees their
    // own client's stores. Among ground (store-level) staff ONLY the Manager can see reports, and
    // only their own store — Shift Incharge and Process Associate are deliberately excluded for now.
    // To open it up later, add `case 'SHIFT_INCHARGE'` next to MANAGER below.
    case 'reports:view':
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return inClient(ctx.clientId);
        case 'MANAGER': return inStore(ctx.storeId);
        default: return false;
      }

    // Manual attendance entry — for MANUAL-mode stores only (runtime check in action)
    case 'attendance:manualEntry':
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return inClient(ctx.clientId);
        case 'MANAGER':
        case 'SHIFT_INCHARGE': return inStore(ctx.storeId);
        default: return false;
      }

    // Face-scan attendance on a phone — MANUAL-mode stores only (runtime check
    // in the action). Unlike manual entry, Process Associates may punch too.
    case 'attendance:facePunch':
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return inClient(ctx.clientId);
        case 'MANAGER':
        case 'SHIFT_INCHARGE':
        case 'PROCESS_ASSOCIATE': return inStore(ctx.storeId);
        default: return false;
      }

    // Enrolling / removing an employee's face data. Deliberately NOT open to
    // Process Associates: whoever enrols a face decides who that face "is",
    // so this is kept to the roles that already own the store roster.
    case 'attendance:faceEnroll':
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return inClient(ctx.clientId);
        case 'MANAGER':
        case 'SHIFT_INCHARGE': return inStore(ctx.storeId);
        default: return false;
      }

    // CSV upload — same scope as manual entry, but explicitly BOTH
    // Manual and Biometric stores (unlike attendance:manualEntry, which is
    // gated at the action layer to MANUAL-mode stores only).
    case 'attendance:csvUpload':
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return inClient(ctx.clientId);
        case 'MANAGER':
        case 'SHIFT_INCHARGE': return inStore(ctx.storeId);
        default: return false;
      }

    // Filing a late-upload-access request — same people who can upload.
    case 'attendance:lateAccess:request':
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return inClient(ctx.clientId);
        case 'MANAGER':
        case 'SHIFT_INCHARGE': return inStore(ctx.storeId);
        default: return false;
      }

    // Approving/denying a late-upload-access request — Admin only (spec decision).
    case 'attendance:lateAccess:approve':
      return role === 'ADMIN';

    // Setting client-default / store-override deadline policy — Admin only.
    case 'attendance:deadlinePolicy:manage':
      return role === 'ADMIN';

    // ── Device management ─────────────────────────────────────────────
    case 'device:manage':
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return inClient(ctx.clientId);
        default: return false;
      }

    // ── Store management ─────────────────────────────────────────────
    case 'store:create':
    case 'store:manage':
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return inClient(ctx.clientId);
        default: return false;
      }

    // ── Client management ─────────────────────────────────────────────
    case 'client:create':
    case 'client:manage':
      return role === 'ADMIN';

    // ── User management ───────────────────────────────────────────────
    case 'user:manage':
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return inClient(ctx.clientId);
        case 'MANAGER': return inStore(ctx.storeId);
        default: return false;
      }

    // ── Master data (designations, grades, teams, warehouse types) ─────────
    case 'masterData:manage':
      return role === 'ADMIN';

    // ── Audit log ────────────────────────────────────────────────────
    case 'auditLog:view':
      return role === 'ADMIN' || role === 'CLIENT';

    // ── Sync issues / command queue management ───────────────────────
    case 'syncIssues:view':
      return role === 'ADMIN' || role === 'CLIENT' || role === 'MANAGER';

    case 'syncIssues:retry':
      return role === 'ADMIN';

    // Reconciling Google Form submissions that matched no employee.
    case 'formSubmissions:manage':
      return role === 'ADMIN';

    // ── Form tracking ────────────────────────────────────────────────
    case 'formTracking:view':
      switch (role) {
        case 'ADMIN':
        case 'CLIENT': return true;
        case 'MANAGER':
        case 'SHIFT_INCHARGE': return inStore(ctx.storeId);
        default: return false;
      }

    case 'formTracking:remind':
      switch (role) {
        case 'ADMIN':
        case 'CLIENT': return true;
        case 'MANAGER':
        case 'SHIFT_INCHARGE': return inStore(ctx.storeId);
        default: return false;
      }

    // ── Onboarding Google Form links ─────────────────────────────────
    // Client-wide default: Admin, or a Client for their own account.
    case 'onboardingForm:editClient':
      if (!ONBOARDING_FORM_EDITOR_ROLES.includes(role)) return false;
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return !!ctx.clientId && inClient(ctx.clientId);
        default: return false;
      }

    // Per-store override: Admin, the store's Client, or that store's Manager.
    case 'onboardingForm:editStore':
      if (!ONBOARDING_FORM_EDITOR_ROLES.includes(role)) return false;
      switch (role) {
        case 'ADMIN': return true;
        case 'CLIENT': return !!ctx.clientId && inClient(ctx.clientId);
        case 'MANAGER': return !!ctx.storeId && inStore(ctx.storeId);
        default: return false;
      }

    default:
      return false;
  }
}
