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
  | 'formTracking:remind';

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

    default:
      return false;
  }
}
