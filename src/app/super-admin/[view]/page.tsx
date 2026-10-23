import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SuperAdminWorkspace } from '@/components/super-admin-workspace';
import { getSessionFromCookies } from '@/lib/auth';

const views = ['my-workers', 'admin-overview', 'daily-orders', 'admin-management', 'workspace-operations', 'reports', 'payments', 'interviews', 'announcements', 'branding', 'cms', 'audit', 'security'] as const;
type SuperAdminView = typeof views[number];

export const metadata: Metadata = { title: 'Super Admin Workspace | Leadgen Official', robots: { index: false, follow: false } };

export default async function SuperAdminSectionPage({ params, searchParams }: { params: Promise<{ view: string }>; searchParams: Promise<{ workspace?: string }> }) {
  const session = await getSessionFromCookies();
  if (!session || session.role !== 'super-admin') redirect('/login');
  const { view } = await params;
  const { workspace } = await searchParams;
  if (!views.includes(view as SuperAdminView)) notFound();
  return <SuperAdminWorkspace name={session.name} workspaceId={session.workspaceId || null} view={view as SuperAdminView} initialWorkspaceId={workspace || ''} />;
}
