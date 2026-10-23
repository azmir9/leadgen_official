import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSessionFromCookies } from '@/lib/auth';
import { SuperAdminWorkspace } from '@/components/super-admin-workspace';

export const metadata: Metadata = { title: 'Platform Control | Leadgen Official', robots: { index: false, follow: false } };

export default async function SuperAdminPage() {
  const session = await getSessionFromCookies();

  if (!session || session.role !== 'super-admin') {
    redirect('/login');
  }

  return <SuperAdminWorkspace name={session.name} workspaceId={session.workspaceId || null} />;
}
