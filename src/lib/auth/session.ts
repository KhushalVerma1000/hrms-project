import { auth } from '@/auth';
import { AuthorizationError } from '@/lib/errors';
import { can, type Action, type PermissionContext } from '@/lib/auth/can';
import type { Session } from 'next-auth';

/**
 * Gets the current session, throwing AuthorizationError if not authenticated.
 * Use this at the top of any server action or route handler.
 */
export async function getAuthSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    throw new AuthorizationError('You must be signed in to perform this action');
  }
  return session;
}

/**
 * Gets the current session and checks a specific permission.
 * Throws AuthorizationError if not authenticated or not authorised.
 *
 * @param action - The action to check
 * @param ctx    - Optional scope context
 * @returns The authenticated session (for further use in the caller)
 *
 * @example
 * const session = await requireAuth('employee:hardDelete', { storeId: employee.storeId });
 */
export async function requireAuth(
  action: Action,
  ctx: PermissionContext = {},
): Promise<Session> {
  const session = await getAuthSession();
  if (!can(session, action, ctx)) {
    throw new AuthorizationError();
  }
  return session;
}

/**
 * Returns the current session user, or null if not authenticated.
 * For use in Server Components that need to conditionally render based on auth state.
 */
export async function getOptionalSession(): Promise<Session | null> {
  return auth();
}
