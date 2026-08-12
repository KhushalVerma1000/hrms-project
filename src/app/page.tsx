import { redirect } from 'next/navigation';

/**
 * Root page — redirect to the app dashboard.
 * Middleware will intercept unauthenticated requests and send to /login.
 */
export default function RootPage() {
  redirect('/dashboard');
}
