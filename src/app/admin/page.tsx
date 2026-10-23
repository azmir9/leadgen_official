import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSessionFromCookies } from '@/lib/auth';
import { AdminWorkspace } from '@/components/admin-workspace';

export const metadata: Metadata = { title: 'Admin Workspace | Leadgen Official', robots: { index: false, follow: false } };

export default async function AdminPage() {
  const session = await getSessionFromCookies();

  if (!session || session.role !== 'admin') {
    redirect('/login');
  }

  return <AdminWorkspace name={session.name} workspaceId={session.workspaceId || null} />;
}
