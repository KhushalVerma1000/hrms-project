import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { Role } from '@prisma/client';

/**
 * Route-level access control.
 * This is a coarse-grained first-line guard — all server actions ALSO call
 * can() individually, so this is defence-in-depth, not the sole enforcement.
 */

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/webhooks'];

/** Roles allowed to access each path prefix. */
const ROUTE_GUARDS: Array<{ prefix: string; roles: Role[] }> = [
  {
    prefix: '/admin',
    roles: ['ADMIN'],
  },
  {
    prefix: '/clients',
    roles: ['ADMIN'],
  },
  {
    prefix: '/attendance',
    roles: ['ADMIN', 'CLIENT', 'MANAGER'],
    // PA/SI are explicitly blocked from attendance — see spec Section 7.2
  },
  {
    prefix: '/stores',
    roles: ['ADMIN', 'CLIENT'],
  },
  {
    prefix: '/devices',
    roles: ['ADMIN', 'CLIENT'],
  },
  {
    prefix: '/users',
    roles: ['ADMIN', 'CLIENT', 'MANAGER'],
  },
  // /employees, /onboarding, /dashboard are accessible to all authenticated roles
];

export default auth((req: NextRequest & { auth: { user?: { role?: Role } } | null }) => {
  const { pathname } = req.nextUrl;

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login
  if (!req.auth?.user) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect user with mustChangePassword to change-password page
  // (except if they're already there)
  const user = req.auth.user as { role?: Role; mustChangePassword?: boolean };
  if (user.mustChangePassword && !pathname.startsWith('/change-password')) {
    return NextResponse.redirect(new URL('/change-password', req.url));
  }

  const userRole = user.role;
  if (!userRole) return NextResponse.redirect(new URL('/login', req.url));

  // Check route-specific role guards
  for (const guard of ROUTE_GUARDS) {
    if (pathname.startsWith(guard.prefix)) {
      if (!guard.roles.includes(userRole)) {
        // Redirect to dashboard instead of a hard 403 for better UX
        return NextResponse.redirect(new URL('/dashboard', req.url));
      }
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
