import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AdminWorkspace } from '@/components/admin-workspace';
import { getSessionFromCookies } from '@/lib/auth';

const views = ['workers', 'daily-orders', 'assignments', 'reports', 'orders', 'workspace', 'announcements', 'audit', 'payments', 'interviews', 'security'] as const;
type AdminView = typeof views[number];

export const metadata: Metadata = { title: 'Admin Workspace | Leadgen Official', robots: { index: false, follow: false } };

export default async function AdminSectionPage({ params }: { params: Promise<{ view: string }> }) {
  const session = await getSessionFromCookies();
  if (!session || session.role !== 'admin') redirect('/login');
  const { view } = await params;
  if (!views.includes(view as AdminView)) notFound();
  return <AdminWorkspace name={session.name} workspaceId={session.workspaceId || null} view={view as AdminView} />;
}
