import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/can';
import { FormSubmissionsPanel } from '@/components/onboarding/FormSubmissionsPanel';

export default async function FormSubmissionsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!can(session, 'formSubmissions:manage', {})) redirect('/dashboard');

  return (
    <div className="container mx-auto py-6 px-4">
      <FormSubmissionsPanel />
    </div>
  );
}
