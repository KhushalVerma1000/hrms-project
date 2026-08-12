import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { EmployeeDirectory } from '@/components/employees/EmployeeDirectory';

export default async function EmployeesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <EmployeeDirectory userRole={session.user.role} />
    </div>
  );
}
