import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { SuperAdminAdminDetails } from '@/components/super-admin-admin-details';

export default async function SuperAdminAdminDetailsPage({ params }: { params: Promise<{ adminId: string }> }) {
  const session = await getSessionFromCookies();
  if (!session || session.role !== 'super-admin') redirect('/login');
  const { adminId } = await params;
  return <SuperAdminAdminDetails adminId={adminId} />;
}
